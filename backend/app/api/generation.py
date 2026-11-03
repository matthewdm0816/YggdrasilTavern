from __future__ import annotations

import json

import anyio
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.tree import get_session_or_404
from ..services.generation import start_generation
from ..services.live_generations import GenerationManager, LiveGeneration

router = APIRouter()


def get_generation_manager(request: Request) -> GenerationManager:
    return request.app.state.generations


def live_generation_or_404(db: Session, manager: GenerationManager, run_id: str) -> LiveGeneration:
    live = manager.get(db.get_bind(), run_id)
    if live is None:
        raise HTTPException(status_code=404, detail="这条回复已经不在生成中")
    return live


@router.get("/sessions/{session_id}/generation-runs", response_model=List[schemas.GenerationRunOut])
def list_generation_runs(session_id: str, db: Session = Depends(get_db)) -> List[models.GenerationRun]:
    get_session_or_404(db, session_id)
    return list(
        db.scalars(
            select(models.GenerationRun)
            .where(models.GenerationRun.session_id == session_id)
            .order_by(models.GenerationRun.started_at.desc())
        )
    )


# Declared before /generation-runs/{run_id} so "active" is not read as a run id.
@router.get("/generation-runs/active", response_model=List[schemas.ActiveGenerationOut])
async def list_active_generations(
    db: Session = Depends(get_db),
    manager: GenerationManager = Depends(get_generation_manager),
) -> List[schemas.ActiveGenerationOut]:
    active = []
    for live in manager.active(db.get_bind()):
        base = db.get(models.Message, live.base_message_id) if live.base_message_id else None
        active.append(schemas.ActiveGenerationOut(
            run_id=live.run_id,
            session_id=live.session_id,
            output_message_id=live.output_message_id,
            base_message_id=live.base_message_id,
            base_content=base.content[:200] if base else "",
        ))
    return active


@router.get("/generation-runs/{run_id}", response_model=schemas.GenerationRunOut)
def get_generation_run(run_id: str, db: Session = Depends(get_db)) -> models.GenerationRun:
    run = db.get(models.GenerationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Generation run not found")
    return run


class GenerationStreamingResponse(StreamingResponse):
    """Stream one watcher of a live generation; closing it leaves the generation running."""

    def __init__(self, live: LiveGeneration):
        async def encoded_events():
            events = live.watch()
            try:
                async for event in events:
                    yield f"event: {event.name}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"
            finally:
                await events.aclose()

        super().__init__(encoded_events(), media_type="text/event-stream")

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Unsubscribe now rather than whenever the abandoned generator is collected.
            with anyio.CancelScope(shield=True):
                await self.body_iterator.aclose()


@router.post("/sessions/{session_id}/generate/stream")
async def generate_stream(
    session_id: str,
    payload: schemas.GenerateRequest,
    db: Session = Depends(get_db),
    manager: GenerationManager = Depends(get_generation_manager),
) -> StreamingResponse:
    live = await start_generation(session_id, payload, db, manager)
    return GenerationStreamingResponse(live)


@router.get("/generation-runs/{run_id}/stream")
async def resume_generation_stream(
    run_id: str,
    db: Session = Depends(get_db),
    manager: GenerationManager = Depends(get_generation_manager),
) -> StreamingResponse:
    return GenerationStreamingResponse(live_generation_or_404(db, manager, run_id))


@router.post("/generation-runs/{run_id}/cancel", response_model=schemas.GenerationRunOut)
async def cancel_generation(
    run_id: str,
    db: Session = Depends(get_db),
    manager: GenerationManager = Depends(get_generation_manager),
) -> models.GenerationRun:
    live = live_generation_or_404(db, manager, run_id)
    await manager.stop(live, "cancelled", "Generation stopped by user")
    db.expire_all()
    run = db.get(models.GenerationRun, run_id)
    if run is None:
        raise RuntimeError("Generation run disappeared after it was stopped")
    return run
