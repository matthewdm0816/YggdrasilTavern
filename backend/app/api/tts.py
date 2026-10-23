"""Speech preview and generation from the authenticated user's own messages."""

from __future__ import annotations

import asyncio
from typing import Awaitable, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import tts
from ..services.macros import expand_message_content
from ..services.tts_text import extract_tts_text


router = APIRouter()
T = TypeVar("T")


async def _until_disconnected(request: Request, operation: Awaitable[T]) -> T:
    """Cancel the HTTP request when the browser stops waiting for audio."""
    stopped = asyncio.Event()

    async def disconnected() -> None:
        while not stopped.is_set():
            if await request.is_disconnected():
                return
            if stopped.is_set():
                return
            await asyncio.sleep(0.2)

    work = asyncio.create_task(operation)
    watcher = asyncio.create_task(disconnected())
    try:
        done, _ = await asyncio.wait({work, watcher}, return_when=asyncio.FIRST_COMPLETED)
        if work in done:
            return work.result()
        watcher.result()
        raise HTTPException(status_code=499, detail="语音请求已取消")
    finally:
        # Request.is_disconnected uses an AnyIO cancellation scope; a task
        # cancellation can be consumed inside that scope. The event also ends
        # the watcher after its current probe, so cleanup cannot wait forever.
        stopped.set()
        for task in (work, watcher):
            if not task.done():
                task.cancel()
        await asyncio.gather(work, watcher, return_exceptions=True)


@router.get("/settings/tts", response_model=schemas.TtsSettingsOut)
def get_tts_settings(response: Response, db: Session = Depends(get_db)) -> schemas.TtsSettingsOut:
    response.headers["Cache-Control"] = "no-store"
    return tts.settings_state(db)


@router.put("/settings/tts", response_model=schemas.TtsSettingsOut)
def put_tts_settings(payload: schemas.TtsSettingsUpdate, response: Response, db: Session = Depends(get_db)) -> schemas.TtsSettingsOut:
    try:
        row = tts.save_settings(db, payload)
    except tts.TtsSettingsConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return schemas.TtsSettingsOut.model_validate(row)


@router.post("/tts/voices", response_model=schemas.TtsVoicesOut)
async def get_tts_voices(request: Request, response: Response, db: Session = Depends(get_db)) -> schemas.TtsVoicesOut:
    settings = db.get(models.TtsSettings, tts.SETTINGS_ID)
    if settings is None:
        raise HTTPException(status_code=422, detail="请先保存 MiniMax 请求地址和 API Key，再获取音色列表")
    try:
        voices = await _until_disconnected(request, tts.list_voices(settings))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return schemas.TtsVoicesOut(voices=voices)


@router.post("/messages/{message_id}/tts/preview", response_model=schemas.TtsPreviewOut)
def preview_tts(message_id: str, response: Response, payload: schemas.TtsPreviewRequest | None = None, db: Session = Depends(get_db)) -> schemas.TtsPreviewOut:
    response.headers["Cache-Control"] = "no-store"
    return tts.preview_message(db, message_id, payload.mode if payload else None)


@router.post("/messages/{message_id}/tts", response_class=Response, responses={200: {"content": {"audio/mpeg": {}}, "description": "Generated MP3 audio"}})
async def generate_tts(message_id: str, request: Request, payload: schemas.TtsGenerateRequest | None = None, db: Session = Depends(get_db)) -> Response:
    message = tts.read_message(db, message_id)
    settings = db.get(models.TtsSettings, tts.SETTINGS_ID)
    if settings is None or not settings.enabled:
        raise HTTPException(status_code=409, detail="请先在语音设置中启用 TTS")
    text = expand_message_content(message.session, payload.text) if payload is not None and payload.text is not None else extract_tts_text(expand_message_content(message.session, message.content), settings.text_mode).text
    try:
        audio = await _until_disconnected(request, tts.synthesize(settings, text))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(content=audio, media_type="audio/mpeg", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
