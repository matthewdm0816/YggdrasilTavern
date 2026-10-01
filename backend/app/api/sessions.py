from __future__ import annotations

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.prompt_builder import apply_context_token_limit, build_context, build_limited_context, expand_macros
from ..services.token_counter import cached_tokens_from_usage, count_text_tokens
from ..services.token_limits import default_token_limits
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
from ._shared import (
    normalize_session_preset_or_422 as _normalize_session_preset_or_422,
    update_model as _update_model,
    validate_session_references as _validate_session_references,
    validate_session_worldbooks as _validate_session_worldbooks,
)

router = APIRouter()

@router.get("/sessions", response_model=List[schemas.SessionOut])
def list_sessions(
    db: Session = Depends(get_db),
    folder_id: Optional[str] = None,
    search: Optional[str] = None,
    pinned: Optional[bool] = None,
    archived: Optional[bool] = None,
) -> List[models.ChatSession]:
    stmt = select(models.ChatSession)
    if folder_id is not None:
        stmt = stmt.where(models.ChatSession.folder_id == folder_id)
    if pinned is not None:
        stmt = stmt.where(models.ChatSession.pinned == pinned)
    if archived is not None:
        stmt = stmt.where(models.ChatSession.archived == archived)
    else:
        # By default, hide archived sessions
        stmt = stmt.where(models.ChatSession.archived == False)
    if search:
        stmt = stmt.where(models.ChatSession.title.ilike(f"%{search}%"))
    stmt = stmt.order_by(models.ChatSession.pinned.desc(), models.ChatSession.last_activity_at.desc())
    return list(db.scalars(stmt))


@router.post("/sessions", response_model=schemas.SessionOut)
def create_session(payload: schemas.SessionCreate, db: Session = Depends(get_db)) -> models.ChatSession:
    data = payload.model_dump()
    data["preset"] = _normalize_session_preset_or_422(data.get("preset"))
    _validate_session_references(db, data)
    character = db.get(models.Character, data["character_id"])
    if not character:
        raise HTTPException(status_code=400, detail="Character not found")
    if not data.get("title", "").strip():
        data["title"] = character.name
    _validate_session_worldbooks(db, legacy_worldbook_id=data.get("worldbook_id"), preset=data["preset"])
    if data.get("active_root_child_id") is not None:
        raise HTTPException(status_code=400, detail="A new session cannot select an existing message")
    session = models.ChatSession(**data)
    try:
        db.add(session)
        db.flush()
        character = db.get(models.Character, session.character_id)
        profile = db.get(models.APIProfile, session.api_profile_id) if session.api_profile_id else None
        if character and session.preset.get("auto_greeting", True):
            greetings = [character.first_mes, *list(character.alternate_greetings or [])]
            user_name = str(session.preset.get("user_name") or "User")
            first_greeting_id: Optional[str] = None
            for greeting in greetings:
                if not isinstance(greeting, str) or not greeting.strip():
                    continue
                message = create_message(
                    db,
                    session,
                    parent_id=None,
                    role="assistant",
                    speaker=character.name,
                    content=expand_macros(greeting, character, user_name),
                    model=profile.model if profile else None,
                    select_new=first_greeting_id is None,
                    commit=False,
                )
                if first_greeting_id is None:
                    first_greeting_id = message.id
            session.active_root_child_id = first_greeting_id
        db.commit()
        db.refresh(session)
    except Exception:
        db.rollback()
        raise
    return session


@router.patch("/sessions/{session_id}", response_model=schemas.SessionOut)
def update_session(session_id: str, payload: schemas.SessionUpdate, db: Session = Depends(get_db)) -> models.ChatSession:
    session = get_session_or_404(db, session_id)
    data = payload.model_dump(exclude_unset=True)
    if "character_id" in data and data["character_id"] is None:
        raise HTTPException(status_code=422, detail="Chat session 必须保留一个角色")
    if "preset" in data:
        data["preset"] = _normalize_session_preset_or_422(data["preset"])
    _validate_session_references(db, data)
    prospective_preset = data.get("preset", session.preset or {})
    prospective_worldbook_id = data.get("worldbook_id", session.worldbook_id)
    _validate_session_worldbooks(db, legacy_worldbook_id=prospective_worldbook_id, preset=prospective_preset)
    selected_root_id = data.get("active_root_child_id")
    if selected_root_id is not None:
        selected_root = get_message_or_404(db, selected_root_id)
        if selected_root.session_id != session.id or selected_root.parent_id is not None:
            raise HTTPException(status_code=400, detail="Active root message is invalid for this session")
    for key, value in data.items():
        setattr(session, key, value)
    session.last_activity_at = models.utc_now()
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
        model=session.api_profile.model if session.api_profile else None,
    )


@router.patch("/messages/{message_id}", response_model=schemas.MessageOut)
def update_message(message_id: str, payload: schemas.MessageUpdate, db: Session = Depends(get_db)) -> models.Message:
    message = get_message_or_404(db, message_id)
    _update_model(message, payload)
    session = get_session_or_404(db, message.session_id)
    model_name = session.api_profile.model if session.api_profile else None
    message.token_count = count_text_tokens(message.content, model_name)
    message.thinking_token_count = count_text_tokens(message.thinking_content, model_name)
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
    session = get_session_or_404(db, base.session_id)
    swipe = create_swipe(
        db,
        base,
        role=payload.role,
        speaker=payload.speaker,
        content=payload.content,
        thinking_content=payload.thinking_content,
        status=payload.status,
        model=session.api_profile.model if session.api_profile else None,
    )
    return schemas.SessionTreeOut(session=session, messages=list_messages(db, session.id), active_path_ids=active_path_ids(db, session))


@router.post("/sessions/{session_id}/context/preview", response_model=schemas.ContextPreviewOut)
def context_preview(
    session_id: str,
    payload: Optional[schemas.ContextPreviewRequest] = None,
    db: Session = Depends(get_db),
) -> schemas.ContextPreviewOut:
    session = get_session_or_404(db, session_id)
    requested_profile_id = payload.api_profile_id if payload else None
    profile = db.get(models.APIProfile, requested_profile_id) if requested_profile_id else session.api_profile
    if profile:
        try:
            return build_limited_context(db, session, profile)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return apply_context_token_limit(
        build_context(db, session),
        model="",
        limits=default_token_limits(),
    )
