"""One generation run: selected tree path, provider stream, durable state and usage."""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Dict, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from . import providers
from .errors import ApplicationError
from .prompt_builder import build_limited_context, prompt_errors
from .token_counter import (
    cached_tokens_from_usage,
    count_text_tokens,
    input_tokens_from_usage,
    merge_usage,
    optional_reasoning_tokens_from_usage,
    output_tokens_from_usage,
    reasoning_tokens_from_usage,
)
from .tree import active_path, ancestor_path, create_message, get_message_or_404, get_session_or_404


@dataclass(frozen=True)
class GenerationEvent:
    name: str
    data: Dict[str, Any]


@dataclass
class GenerationHandle:
    """Own the persisted run until its stream completes or the caller closes it."""

    db: Session
    run_id: str
    output_message_id: str
    events: AsyncGenerator[GenerationEvent, None]

    async def aclose(self) -> None:
        try:
            await self.events.aclose()
        finally:
            self._interrupt_if_streaming()

    def _interrupt_if_streaming(self) -> None:
        self.db.rollback()
        run = self.db.get(models.GenerationRun, self.run_id)
        if run is None:
            raise RuntimeError("Generation run disappeared before it could be finalized")
        if run.status != "streaming":
            return
        message = self.db.get(models.Message, self.output_message_id)
        session = self.db.get(models.ChatSession, run.session_id)
        if message is None or session is None:
            raise RuntimeError("Generation state disappeared before it could be finalized")
        reason = "Generation stream closed before completion"
        message.status = "interrupted"
        message.error = reason
        message.provider_metadata = {
            **dict(message.provider_metadata or {}),
            "generation_status": "interrupted",
        }
        run.status = "interrupted"
        run.error = reason
        run.completed_at = models.utc_now()
        session.last_activity_at = models.utc_now()
        self.db.commit()


def _prompt_snapshot(context: schemas.ContextPreviewOut) -> tuple[Dict[str, Any], str]:
    snapshot = context.model_dump(mode="json")
    canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return snapshot, hashlib.sha256(canonical.encode("utf-8")).hexdigest()

async def start_generation(
    session_id: str,
    payload: schemas.GenerateRequest,
    db: Session,
) -> GenerationHandle:
    session = get_session_or_404(db, session_id)
    if not session.character:
        raise ApplicationError(status_code=400, detail="此 Chat session 没有角色，无法生成回复")
    profile = db.get(models.APIProfile, payload.api_profile_id) if payload.api_profile_id else session.api_profile
    if not profile:
        raise ApplicationError(status_code=400, detail="请先在本地应用中选择一个 API Profile")
    active_run_id = db.scalar(
        select(models.GenerationRun.id).where(
            models.GenerationRun.session_id == session.id,
            models.GenerationRun.status == "streaming",
        ).limit(1)
    )
    if active_run_id is not None:
        raise ApplicationError(status_code=409, detail="此 Chat session 已有进行中的生成，请等待或取消后重试")
    path = active_path(db, session)
    parent_id = path[-1].id if path else None
    context_path = path
    if payload.regenerate_message_id:
        base = get_message_or_404(db, payload.regenerate_message_id)
        if base.session_id != session.id:
            raise ApplicationError(status_code=400, detail="Message belongs to another session")
        if base.role != "assistant":
            raise ApplicationError(status_code=400, detail="Only assistant messages can be regenerated")
        parent_id = base.parent_id
        context_path = ancestor_path(db, base, include_self=False)

    try:
        context = build_limited_context(db, session, profile, path_override=context_path)
    except ValueError as exc:
        raise ApplicationError(status_code=400, detail=str(exc)) from exc
    compilation_errors = prompt_errors(context)
    if compilation_errors:
        raise ApplicationError(
            status_code=400,
            detail={
                "message": "Prompt compilation failed",
                "diagnostics": [item.model_dump(mode="json") for item in compilation_errors],
            },
        )
    snapshot, prompt_hash = _prompt_snapshot(context)
    estimated_input_tokens = context.estimated_input_tokens
    limit_snapshot = {
        "configured_input_tokens": context.configured_input_token_limit,
        "effective_input_tokens": context.effective_input_token_limit,
        "configured_output_tokens": context.configured_output_token_limit,
        "effective_output_tokens": context.effective_output_token_limit,
        "model_max_input_tokens": context.model_max_input_tokens,
        "model_max_output_tokens": context.model_max_output_tokens,
        "model_max_total_tokens": context.model_max_total_tokens,
    }
    run_parameters = {
        **dict(profile.default_params or {}),
        "_yggdrasil_token_limits": limit_snapshot,
    }
    speaker = session.character.name if session.character else "Assistant"
    started_at = models.utc_now()
    started_monotonic = time.monotonic()
    assistant_message = create_message(
        db,
        session,
        parent_id=parent_id,
        role="assistant",
        speaker=speaker,
        content="",
        status="streaming",
        model=profile.model,
        commit=False,
    )

    generation_run = models.GenerationRun(
        session_id=session.id,
        base_message_id=parent_id,
        output_message_id=assistant_message.id,
        api_profile_id=profile.id,
        profile_name=profile.name,
        provider_type=profile.provider_type,
        base_url=profile.base_url,
        model=profile.model,
        parameters=run_parameters,
        prompt_snapshot=snapshot,
        prompt_hash=prompt_hash,
        status="streaming",
        started_at=started_at,
        input_tokens=estimated_input_tokens,
        usage_source="estimated",
    )
    try:
        db.add(generation_run)
        db.flush()
        assistant_message.provider_metadata = {
            **dict(assistant_message.provider_metadata or {}),
            "generation_run_id": generation_run.id,
            "api_profile_id": profile.id,
            "provider_type": profile.provider_type,
            "model": profile.model,
            "parameters": run_parameters,
            "prompt_hash": prompt_hash,
        }
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        competing_run_id = db.scalar(
            select(models.GenerationRun.id).where(
                models.GenerationRun.session_id == session_id,
                models.GenerationRun.status == "streaming",
            ).limit(1)
        )
        if competing_run_id is not None:
            raise ApplicationError(
                status_code=409,
                detail="此 Chat session 已有进行中的生成，请等待或取消后重试",
            ) from exc
        raise ApplicationError(
            status_code=409,
            detail="生成开始前 API Profile 或聊天数据已被修改，请刷新后重试",
        ) from exc
    db.refresh(assistant_message)
    db.refresh(generation_run)
    assistant_message_id = assistant_message.id
    generation_run_id = generation_run.id
    session_id_value = session.id
    model_name = profile.model

    COMMIT_INTERVAL = 2.0  # batch-commit every N seconds to reduce SQLite contention

    async def events():
        full_text = ""
        thinking_text = ""
        usage: Dict[str, Any] = {}
        output_revision = 0
        thinking_revision = 0
        output_usage_revision: Optional[int] = None
        reasoning_usage_revision: Optional[int] = None
        dirty = False
        last_commit = time.monotonic()
        first_token_at = None

        def persist_state(status: str, error: Optional[str], *, terminal: bool) -> models.Message:
            nonlocal first_token_at
            if terminal:
                # A failed batch commit may have expired ORM state. Reload the
                # durable rows, then write the complete in-memory stream buffers.
                db.rollback()
            message_row = db.get(models.Message, assistant_message_id)
            run_row = db.get(models.GenerationRun, generation_run_id)
            session_row = db.get(models.ChatSession, session_id_value)
            if not message_row or not run_row or not session_row:
                raise RuntimeError("Generation state disappeared before it could be persisted")

            text_tokens = count_text_tokens(full_text, model_name)
            estimated_thinking_tokens = count_text_tokens(thinking_text, model_name)
            reported_reasoning_tokens = reasoning_tokens_from_usage(usage)
            provider_input_tokens = input_tokens_from_usage(usage)
            provider_output_tokens = output_tokens_from_usage(usage)
            output_usage_is_stale = bool(
                provider_output_tokens is not None
                and output_usage_revision is not None
                and output_usage_revision < output_revision
            )
            reasoning_usage_is_stale = bool(
                reasoning_usage_revision is not None
                and reasoning_usage_revision < thinking_revision
            )
            if reasoning_usage_is_stale:
                thinking_tokens = max(reported_reasoning_tokens, estimated_thinking_tokens)
            else:
                thinking_tokens = reported_reasoning_tokens or estimated_thinking_tokens
            estimated_output_tokens = text_tokens + thinking_tokens
            if provider_output_tokens is None:
                output_tokens = estimated_output_tokens
            elif output_usage_is_stale:
                output_tokens = max(provider_output_tokens, estimated_output_tokens)
            else:
                output_tokens = provider_output_tokens
            input_tokens = provider_input_tokens if provider_input_tokens is not None else estimated_input_tokens
            cached_input_tokens = cached_tokens_from_usage(usage)
            duration_seconds = max(time.monotonic() - started_monotonic, 0.0)
            tokens_per_second = output_tokens / duration_seconds if duration_seconds > 0 else 0.0
            usage_was_reconciled = output_usage_is_stale or reasoning_usage_is_stale
            if provider_input_tokens is not None and provider_output_tokens is not None and not usage_was_reconciled:
                usage_source = "provider"
            elif provider_input_tokens is not None or provider_output_tokens is not None:
                usage_source = "mixed"
            else:
                usage_source = "estimated"

            message_row.content = full_text
            message_row.thinking_content = thinking_text
            message_row.usage = dict(usage)
            message_row.token_count = text_tokens
            message_row.thinking_token_count = thinking_tokens
            message_row.cached_tokens = cached_input_tokens
            message_row.status = status
            message_row.error = error
            message_row.provider_metadata = {
                **dict(message_row.provider_metadata or {}),
                "generation_status": status,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "cached_input_tokens": cached_input_tokens,
                "tokens_per_second": tokens_per_second,
                "duration_seconds": duration_seconds,
                "usage_reconciled": usage_was_reconciled,
                "observed_output_tokens": estimated_output_tokens,
                "provider_output_tokens": provider_output_tokens,
            }

            run_row.status = status
            run_row.error = error
            run_row.usage = dict(usage)
            run_row.usage_source = usage_source
            run_row.input_tokens = input_tokens
            run_row.output_tokens = output_tokens
            run_row.cached_input_tokens = cached_input_tokens
            run_row.tokens_per_second = tokens_per_second
            run_row.duration_seconds = duration_seconds
            run_row.first_token_at = first_token_at
            if terminal:
                run_row.completed_at = models.utc_now()
            session_row.last_activity_at = models.utc_now()
            db.commit()
            db.refresh(message_row)
            db.refresh(run_row)
            db.expire(message_row, ["generation_run"])
            return message_row

        try:
            db.expire(assistant_message, ["generation_run"])
            yield GenerationEvent("message_created", schemas.MessageOut.model_validate(assistant_message).model_dump(mode="json"))
            async for event in providers.stream_completion(profile, context):
                if isinstance(event, str):
                    full_text += event
                    if event:
                        output_revision += 1
                    if event and first_token_at is None:
                        first_token_at = models.utc_now()
                    dirty = True
                    yield GenerationEvent("token", {"message_id": assistant_message_id, "delta": event})
                elif event.kind == "thinking":
                    thinking_text += event.delta
                    if event.delta:
                        output_revision += 1
                        thinking_revision += 1
                    if event.delta and first_token_at is None:
                        first_token_at = models.utc_now()
                    dirty = True
                    yield GenerationEvent("thinking", {"message_id": assistant_message_id, "delta": event.delta})
                elif event.kind == "text":
                    full_text += event.delta
                    if event.delta:
                        output_revision += 1
                    if event.delta and first_token_at is None:
                        first_token_at = models.utc_now()
                    dirty = True
                    yield GenerationEvent("token", {"message_id": assistant_message_id, "delta": event.delta})
                elif event.kind == "usage":
                    usage = merge_usage(usage, event.usage)
                    if output_tokens_from_usage(event.usage) is not None:
                        output_usage_revision = output_revision
                    if optional_reasoning_tokens_from_usage(event.usage) is not None:
                        reasoning_usage_revision = thinking_revision
                    dirty = True
                    yield GenerationEvent("usage", {"message_id": assistant_message_id, "usage": usage})
                # Batch-commit: flush dirty state periodically instead of every token
                now = time.monotonic()
                if dirty and now - last_commit >= COMMIT_INTERVAL:
                    persist_state("streaming", None, terminal=False)
                    dirty = False
                    last_commit = now
            completed_message = persist_state("complete", None, terminal=True)
            yield GenerationEvent("message_completed", schemas.MessageOut.model_validate(completed_message).model_dump(mode="json"))
        except asyncio.CancelledError:
            persist_state("cancelled", "Generation cancelled by client disconnect", terminal=True)
            raise
        except GeneratorExit:
            persist_state("interrupted", "Generation stream closed before completion", terminal=True)
            raise
        except Exception as exc:
            detail = str(getattr(exc, "detail", exc))
            try:
                failed_message = persist_state("failed", detail, terminal=True)
                message_data = schemas.MessageOut.model_validate(failed_message).model_dump(mode="json")
            except Exception as persistence_exc:
                db.rollback()
                message_data = None
                detail = f"{detail}; additionally failed to persist partial generation: {persistence_exc}"
            yield GenerationEvent(
                "error",
                {"message_id": assistant_message_id, "detail": detail, "message": message_data},
            )
        except BaseException as exc:
            persist_state("interrupted", str(exc) or "Generation interrupted", terminal=True)
            raise

    return GenerationHandle(
        db=db,
        run_id=generation_run_id,
        output_message_id=assistant_message_id,
        events=events(),
    )
