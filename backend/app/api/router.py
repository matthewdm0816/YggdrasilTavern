from __future__ import annotations

import json
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import chub_import, providers, st_import
from ..services.prompt_builder import build_context
from ..services.token_counter import cached_tokens_from_usage, count_text_tokens, merge_usage, reasoning_tokens_from_usage
from ..services.tree import (
    active_path,
    active_path_ids,
    create_message,
    create_swipe,
    get_message_or_404,
    get_session_or_404,
    last_active_message,
    list_messages,
    select_message,
)

router = APIRouter(prefix="/api")


def _update_model(instance: Any, payload: Any) -> Any:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(instance, key, value)
    return instance


def _json_event(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@router.get("/api-profiles", response_model=List[schemas.APIProfileOut])
def list_api_profiles(db: Session = Depends(get_db)) -> List[models.APIProfile]:
    return list(db.scalars(select(models.APIProfile).order_by(models.APIProfile.created_at.desc())))


@router.post("/api-profiles", response_model=schemas.APIProfileOut)
def create_api_profile(payload: schemas.APIProfileCreate, db: Session = Depends(get_db)) -> models.APIProfile:
    profile = models.APIProfile(**payload.model_dump())
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.patch("/api-profiles/{profile_id}", response_model=schemas.APIProfileOut)
def update_api_profile(profile_id: str, payload: schemas.APIProfileUpdate, db: Session = Depends(get_db)) -> models.APIProfile:
    profile = db.get(models.APIProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="API profile not found")
    _update_model(profile, payload)
    db.commit()
    db.refresh(profile)
    return profile


@router.delete("/api-profiles/{profile_id}")
def delete_api_profile(profile_id: str, db: Session = Depends(get_db)) -> Dict[str, bool]:
    profile = db.get(models.APIProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="API profile not found")
    db.delete(profile)
    db.commit()
    return {"ok": True}


@router.get("/characters", response_model=List[schemas.CharacterOut])
def list_characters(db: Session = Depends(get_db)) -> List[models.Character]:
    return list(db.scalars(select(models.Character).order_by(models.Character.updated_at.desc())))


@router.post("/characters", response_model=schemas.CharacterOut)
def create_character(payload: schemas.CharacterCreate, db: Session = Depends(get_db)) -> models.Character:
    character = models.Character(**payload.model_dump())
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@router.post("/characters/import", response_model=schemas.CharacterOut)
async def import_character(file: UploadFile = File(...), db: Session = Depends(get_db)) -> models.Character:
    payload = st_import.load_character_upload(file.filename or "character.json", await file.read())
    character = models.Character(**payload.model_dump())
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@router.post("/characters/import/chub", response_model=schemas.CharacterOut)
async def import_chub_character(payload: schemas.ChubImportRequest, db: Session = Depends(get_db)) -> models.Character:
    character_payload = await chub_import.import_chub_character(payload.url_or_path)
    character = models.Character(**character_payload.model_dump())
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@router.patch("/characters/{character_id}", response_model=schemas.CharacterOut)
def update_character(character_id: str, payload: schemas.CharacterUpdate, db: Session = Depends(get_db)) -> models.Character:
    character = db.get(models.Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    _update_model(character, payload)
    db.commit()
    db.refresh(character)
    return character


@router.get("/characters/{character_id}/export")
def export_character(character_id: str, db: Session = Depends(get_db)) -> JSONResponse:
    character = db.get(models.Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    return JSONResponse(st_import.character_to_v2_json(character))


@router.delete("/characters/{character_id}")
def delete_character(character_id: str, db: Session = Depends(get_db)) -> Dict[str, bool]:
    character = db.get(models.Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    db.delete(character)
    db.commit()
    return {"ok": True}


def _create_worldbook_model(payload: schemas.WorldBookCreate) -> models.WorldBook:
    data = payload.model_dump()
    entries = data.pop("entries", [])
    worldbook = models.WorldBook(**data)
    worldbook.entries = [models.WorldBookEntry(**entry) for entry in entries]
    return worldbook


@router.get("/worldbooks", response_model=List[schemas.WorldBookOut])
def list_worldbooks(db: Session = Depends(get_db)) -> List[models.WorldBook]:
    return list(db.scalars(select(models.WorldBook).order_by(models.WorldBook.updated_at.desc())))


@router.post("/worldbooks", response_model=schemas.WorldBookOut)
def create_worldbook(payload: schemas.WorldBookCreate, db: Session = Depends(get_db)) -> models.WorldBook:
    worldbook = _create_worldbook_model(payload)
    db.add(worldbook)
    db.commit()
    db.refresh(worldbook)
    return worldbook


@router.post("/worldbooks/import", response_model=schemas.WorldBookOut)
async def import_worldbook(file: UploadFile = File(...), db: Session = Depends(get_db)) -> models.WorldBook:
    payload = st_import.load_worldbook_upload(await file.read())
    worldbook = _create_worldbook_model(payload)
    db.add(worldbook)
    db.commit()
    db.refresh(worldbook)
    return worldbook


@router.post("/worldbooks/import/chub", response_model=schemas.WorldBookOut)
async def import_chub_worldbook(payload: schemas.ChubImportRequest, db: Session = Depends(get_db)) -> models.WorldBook:
    worldbook_payload = await chub_import.import_chub_worldbook(payload.url_or_path)
    worldbook = _create_worldbook_model(worldbook_payload)
    db.add(worldbook)
    db.commit()
    db.refresh(worldbook)
    return worldbook


@router.patch("/worldbooks/{worldbook_id}", response_model=schemas.WorldBookOut)
def update_worldbook(worldbook_id: str, payload: schemas.WorldBookUpdate, db: Session = Depends(get_db)) -> models.WorldBook:
    worldbook = db.get(models.WorldBook, worldbook_id)
    if not worldbook:
        raise HTTPException(status_code=404, detail="Worldbook not found")
    data = payload.model_dump(exclude_unset=True)
    entries = data.pop("entries", None)
    for key, value in data.items():
        setattr(worldbook, key, value)
    if entries is not None:
        worldbook.entries.clear()
        db.flush()
        worldbook.entries = [models.WorldBookEntry(**entry) for entry in entries]
    db.commit()
    db.refresh(worldbook)
    return worldbook


@router.get("/worldbooks/{worldbook_id}/export")
def export_worldbook(worldbook_id: str, db: Session = Depends(get_db)) -> JSONResponse:
    worldbook = db.get(models.WorldBook, worldbook_id)
    if not worldbook:
        raise HTTPException(status_code=404, detail="Worldbook not found")
    data = dict(worldbook.raw_json or {})
    data.update(
        {
            "name": worldbook.name,
            "description": worldbook.description,
            "scan_depth": worldbook.scan_depth,
            "token_budget": worldbook.token_budget,
            "entries": [entry.raw_json or schemas.WorldBookEntryOut.model_validate(entry).model_dump(mode="json") for entry in worldbook.entries],
        }
    )
    return JSONResponse(data)


@router.delete("/worldbooks/{worldbook_id}")
def delete_worldbook(worldbook_id: str, db: Session = Depends(get_db)) -> Dict[str, bool]:
    worldbook = db.get(models.WorldBook, worldbook_id)
    if not worldbook:
        raise HTTPException(status_code=404, detail="Worldbook not found")
    db.delete(worldbook)
    db.commit()
    return {"ok": True}


@router.get("/sessions", response_model=List[schemas.SessionOut])
def list_sessions(db: Session = Depends(get_db)) -> List[models.ChatSession]:
    return list(db.scalars(select(models.ChatSession).order_by(models.ChatSession.updated_at.desc())))


@router.post("/sessions", response_model=schemas.SessionOut)
def create_session(payload: schemas.SessionCreate, db: Session = Depends(get_db)) -> models.ChatSession:
    session = models.ChatSession(**payload.model_dump())
    db.add(session)
    db.commit()
    db.refresh(session)
    if session.character and session.character.first_mes and (session.preset or {}).get("auto_greeting", True):
        create_message(
            db,
            session,
            parent_id=None,
            role="assistant",
            speaker=session.character.name,
            content=session.character.first_mes,
        )
        db.refresh(session)
    return session


@router.patch("/sessions/{session_id}", response_model=schemas.SessionOut)
def update_session(session_id: str, payload: schemas.SessionUpdate, db: Session = Depends(get_db)) -> models.ChatSession:
    session = get_session_or_404(db, session_id)
    _update_model(session, payload)
    db.commit()
    db.refresh(session)
    return session


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str, db: Session = Depends(get_db)) -> Dict[str, bool]:
    session = get_session_or_404(db, session_id)
    db.delete(session)
    db.commit()
    return {"ok": True}


@router.get("/sessions/{session_id}/tree", response_model=schemas.SessionTreeOut)
def get_session_tree(session_id: str, db: Session = Depends(get_db)) -> schemas.SessionTreeOut:
    session = get_session_or_404(db, session_id)
    return schemas.SessionTreeOut(session=session, messages=list_messages(db, session.id), active_path_ids=active_path_ids(db, session))


@router.get("/sessions/{session_id}/active-path", response_model=List[schemas.MessageOut])
def get_active_path(session_id: str, db: Session = Depends(get_db)) -> List[models.Message]:
    session = get_session_or_404(db, session_id)
    return active_path(db, session)


@router.post("/sessions/{session_id}/messages", response_model=schemas.MessageOut)
def append_message(session_id: str, payload: schemas.MessageCreate, db: Session = Depends(get_db)) -> models.Message:
    session = get_session_or_404(db, session_id)
    parent_id = payload.parent_id
    if parent_id is None:
        last = last_active_message(db, session)
        parent_id = last.id if last else None
    return create_message(
        db,
        session,
        parent_id=parent_id,
        role=payload.role,
        speaker=payload.speaker,
        content=payload.content,
        status=payload.status,
    )


@router.patch("/messages/{message_id}", response_model=schemas.MessageOut)
def update_message(message_id: str, payload: schemas.MessageUpdate, db: Session = Depends(get_db)) -> models.Message:
    message = get_message_or_404(db, message_id)
    _update_model(message, payload)
    message.token_count = count_text_tokens(message.content)
    message.thinking_token_count = count_text_tokens(message.thinking_content)
    message.cached_tokens = cached_tokens_from_usage(message.usage)
    db.commit()
    db.refresh(message)
    return message


@router.post("/messages/{message_id}/select", response_model=schemas.SessionTreeOut)
def select_message_endpoint(message_id: str, db: Session = Depends(get_db)) -> schemas.SessionTreeOut:
    message = get_message_or_404(db, message_id)
    session = select_message(db, message)
    return schemas.SessionTreeOut(session=session, messages=list_messages(db, session.id), active_path_ids=active_path_ids(db, session))


@router.post("/messages/{message_id}/swipes", response_model=schemas.SessionTreeOut)
def create_swipe_endpoint(message_id: str, payload: schemas.SwipeCreate, db: Session = Depends(get_db)) -> schemas.SessionTreeOut:
    base = get_message_or_404(db, message_id)
    swipe = create_swipe(
        db,
        base,
        role=payload.role,
        speaker=payload.speaker,
        content=payload.content,
        thinking_content=payload.thinking_content,
        status=payload.status,
    )
    session = get_session_or_404(db, swipe.session_id)
    return schemas.SessionTreeOut(session=session, messages=list_messages(db, session.id), active_path_ids=active_path_ids(db, session))


@router.post("/sessions/{session_id}/context/preview", response_model=schemas.ContextPreviewOut)
def context_preview(session_id: str, db: Session = Depends(get_db)) -> schemas.ContextPreviewOut:
    session = get_session_or_404(db, session_id)
    return build_context(db, session)


@router.post("/sessions/{session_id}/generate/stream")
async def generate_stream(
    session_id: str,
    payload: schemas.GenerateRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    session = get_session_or_404(db, session_id)
    if not session.api_profile:
        raise HTTPException(status_code=400, detail="Session has no API profile")

    path = active_path(db, session)
    parent_id = path[-1].id if path else None
    context_path = path
    if payload.regenerate_message_id:
        base = get_message_or_404(db, payload.regenerate_message_id)
        if base.session_id != session.id:
            raise HTTPException(status_code=400, detail="Message belongs to another session")
        parent_id = base.parent_id
        if parent_id is None:
            context_path = []
        else:
            context_path = []
            for message in path:
                context_path.append(message)
                if message.id == parent_id:
                    break

    context = build_context(db, session, path_override=context_path)
    speaker = session.character.name if session.character else "Assistant"
    assistant_message = create_message(
        db,
        session,
        parent_id=parent_id,
        role="assistant",
        speaker=speaker,
        content="",
        status="streaming",
    )
    profile = session.api_profile

    async def events():
        full_text = ""
        thinking_text = ""
        usage: Dict[str, Any] = {}
        yield _json_event("message_created", schemas.MessageOut.model_validate(assistant_message).model_dump(mode="json"))
        try:
            async for event in providers.stream_completion(profile, context):
                if isinstance(event, str):
                    full_text += event
                    assistant_message.content = full_text
                    assistant_message.token_count = count_text_tokens(full_text, profile.model)
                    db.commit()
                    yield _json_event("token", {"message_id": assistant_message.id, "delta": event})
                    continue
                if event.kind == "thinking":
                    thinking_text += event.delta
                    assistant_message.thinking_content = thinking_text
                    assistant_message.thinking_token_count = count_text_tokens(thinking_text, profile.model)
                    db.commit()
                    yield _json_event("thinking", {"message_id": assistant_message.id, "delta": event.delta})
                elif event.kind == "text":
                    full_text += event.delta
                    assistant_message.content = full_text
                    assistant_message.token_count = count_text_tokens(full_text, profile.model)
                    db.commit()
                    yield _json_event("token", {"message_id": assistant_message.id, "delta": event.delta})
                elif event.kind == "usage":
                    usage = merge_usage(usage, event.usage)
                    assistant_message.usage = usage
                    assistant_message.cached_tokens = cached_tokens_from_usage(usage)
                    assistant_message.provider_metadata = {
                        **(assistant_message.provider_metadata or {}),
                        "reasoning_tokens": reasoning_tokens_from_usage(usage),
                    }
                    db.commit()
                    yield _json_event("usage", {"message_id": assistant_message.id, "usage": usage})
            assistant_message.status = "complete"
            assistant_message.error = None
            assistant_message.content = full_text
            assistant_message.thinking_content = thinking_text
            assistant_message.usage = usage
            assistant_message.token_count = count_text_tokens(full_text, profile.model)
            assistant_message.thinking_token_count = count_text_tokens(thinking_text, profile.model)
            assistant_message.cached_tokens = cached_tokens_from_usage(usage)
            db.commit()
            db.refresh(assistant_message)
            yield _json_event("message_completed", schemas.MessageOut.model_validate(assistant_message).model_dump(mode="json"))
        except Exception as exc:
            assistant_message.status = "failed"
            assistant_message.error = str(getattr(exc, "detail", exc))
            db.commit()
            db.refresh(assistant_message)
            yield _json_event("error", {"message_id": assistant_message.id, "detail": assistant_message.error})

    return StreamingResponse(events(), media_type="text/event-stream")
