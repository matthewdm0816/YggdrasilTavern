"""Generations that keep running after the HTTP stream that started them closes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Dict, Optional

from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

TERMINAL_EVENTS = frozenset({"message_completed", "message_stopped", "error"})


@dataclass(frozen=True)
class GenerationEvent:
    name: str
    data: Dict[str, Any]


class LiveGeneration:
    """One running reply: its latest message state and the streams watching it."""

    def __init__(
        self,
        *,
        engine: Engine,
        run_id: str,
        session_id: str,
        output_message_id: str,
        base_message_id: Optional[str],
        message: Dict[str, Any],
    ):
        self.engine = engine
        self.run_id = run_id
        self.session_id = session_id
        self.output_message_id = output_message_id
        self.base_message_id = base_message_id
        # MessageOut JSON including every delta received so far.
        self.message = message
        self.terminal: Optional[GenerationEvent] = None
        # (status, error) recorded when the app cancels the run on purpose.
        self.stop_reason: Optional[tuple[str, str]] = None
        self.task: Optional[asyncio.Task[None]] = None
        self._watchers: set[asyncio.Queue[GenerationEvent]] = set()

    def publish(self, event: GenerationEvent) -> None:
        if event.name == "token":
            self.message = {**self.message, "content": self.message["content"] + event.data["delta"]}
        elif event.name == "thinking":
            self.message = {**self.message, "thinking_content": self.message["thinking_content"] + event.data["delta"]}
        elif event.name == "usage":
            self.message = {**self.message, "usage": event.data["usage"]}
        elif event.name in TERMINAL_EVENTS:
            final = event.data.get("message") if event.name == "error" else event.data
            if final is not None:
                self.message = final
            self.terminal = event
        for queue in self._watchers:
            queue.put_nowait(event)

    async def watch(self) -> AsyncIterator[GenerationEvent]:
        """Yield the reply so far as message_created, then each later event until the run ends."""
        queue: asyncio.Queue[GenerationEvent] = asyncio.Queue()
        # No await separates the snapshot from subscribing, so no delta is lost or repeated.
        snapshot = GenerationEvent("message_created", self.message)
        terminal = self.terminal
        if terminal is None:
            self._watchers.add(queue)
        try:
            yield snapshot
            if terminal is not None:
                yield terminal
                return
            while True:
                event = await queue.get()
                yield event
                if event.name in TERMINAL_EVENTS:
                    return
        finally:
            self._watchers.discard(queue)


class GenerationManager:
    """Every live generation of this process, owned by the app rather than by one request."""

    def __init__(self) -> None:
        self._runs: dict[str, LiveGeneration] = {}

    def start(self, live: LiveGeneration, produce: Callable[[LiveGeneration], Awaitable[None]]) -> None:
        self._runs[live.run_id] = live
        live.task = asyncio.create_task(self._run(live, produce), name=f"generation-{live.run_id}")
        live.task.add_done_callback(_report_failure)

    async def _run(self, live: LiveGeneration, produce: Callable[[LiveGeneration], Awaitable[None]]) -> None:
        try:
            await produce(live)
        except Exception as exc:
            # Watchers wait for a terminal event; never leave them hanging.
            if live.terminal is None:
                live.publish(GenerationEvent("error", {
                    "message_id": live.output_message_id,
                    "detail": f"生成意外中止：{exc}",
                    "message": None,
                }))
            raise
        finally:
            self._runs.pop(live.run_id, None)

    def get(self, engine: Engine, run_id: str) -> Optional[LiveGeneration]:
        live = self._runs.get(run_id)
        # A run in another account's database is invisible to this caller.
        return live if live is not None and live.engine is engine else None

    def active(self, engine: Engine) -> list[LiveGeneration]:
        return [live for live in self._runs.values() if live.engine is engine]

    async def stop(self, live: LiveGeneration, status: str, error: str) -> None:
        if live.task is None or live.task.done():
            return
        if live.stop_reason is None:
            live.stop_reason = (status, error)
        # A task cancelled before its first step never enters produce() and so
        # never saves its final state; let it reach its first await.
        await asyncio.sleep(0)
        if live.task.done():
            return
        live.task.cancel()
        await asyncio.wait({live.task})

    async def shutdown(self) -> None:
        await asyncio.gather(*(
            self.stop(live, "interrupted", "Generation interrupted by server shutdown")
            for live in list(self._runs.values())
        ))


def _report_failure(task: asyncio.Task[None]) -> None:
    if not task.cancelled() and task.exception() is not None:
        logger.error("Generation task %s failed", task.get_name(), exc_info=task.exception())
