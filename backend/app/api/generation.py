from __future__ import annotations

import json

import anyio
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.tree import get_session_or_404
from ..services.generation import GenerationHandle, start_generation

router = APIRouter()

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


@router.get("/generation-runs/{run_id}", response_model=schemas.GenerationRunOut)
def get_generation_run(run_id: str, db: Session = Depends(get_db)) -> models.GenerationRun:
    run = db.get(models.GenerationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Generation run not found")
    return run


class GenerationStreamingResponse(StreamingResponse):
    """Close the durable run even if ASGI stops before its first stream event."""

    def __init__(self, handle: GenerationHandle):
        self.handle = handle

        async def encoded_events():
            async for event in handle.events:
                yield f"event: {event.name}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"

        super().__init__(encoded_events(), media_type="text/event-stream")

    async def __call__(self, scope, receive, send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            with anyio.CancelScope(shield=True):
                try:
                    await self.body_iterator.aclose()
                finally:
                    await self.handle.aclose()


@router.post("/sessions/{session_id}/generate/stream")
async def generate_stream(
    session_id: str,
    payload: schemas.GenerateRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    handle = await start_generation(session_id, payload, db)
    return GenerationStreamingResponse(handle)
