from __future__ import annotations

import asyncio
import hashlib
import json
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import chub_import, providers, st_import
from ..services.prompt_builder import build_context, expand_macros, prompt_errors
from ..services.prompt_config import (
    PromptConfigConflict,
    global_prompt_state,
    normalize_session_preset,
    save_global_prompt_config,
    unique_worldbook_ids,
)
from ..services.token_counter import (
    cached_tokens_from_usage,
    count_text_tokens,
    input_tokens_from_usage,
    merge_usage,
    output_tokens_from_usage,
    reasoning_tokens_from_usage,
)
from ..services.tree import (
    active_path,
    active_path_ids,
    ancestor_path,
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


def _require_reference(db: Session, model: Any, object_id: Optional[str], label: str) -> None:
    if object_id is not None and db.get(model, object_id) is None:
        raise HTTPException(status_code=400, detail=f"{label} not found")


def _validate_session_references(db: Session, data: Dict[str, Any]) -> None:
    _require_reference(db, models.Character, data.get("character_id"), "Character")
    _require_reference(db, models.APIProfile, data.get("api_profile_id"), "API profile")
    _require_reference(db, models.WorldBook, data.get("worldbook_id"), "Worldbook")
    _require_reference(db, models.SessionFolder, data.get("folder_id"), "Folder")


def _prompt_snapshot(context: schemas.ContextPreviewOut) -> tuple[Dict[str, Any], str]:
    snapshot = context.model_dump(mode="json")
    canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return snapshot, hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _estimate_context_tokens(context: schemas.ContextPreviewOut, model: str) -> int:
    total = count_text_tokens(context.system, model)
    total += sum(count_text_tokens(message.content, model) for message in context.messages)
    return total


def _character_create_data(payload: schemas.CharacterCreate) -> Dict[str, Any]:
    data = payload.model_dump()
    if data.get("avatar_original_data_url") is None and data.get("avatar_data_url"):
        data["avatar_original_data_url"] = data["avatar_data_url"]
    return data


def _api_profile_write_data(payload: schemas.APIProfileCreate | schemas.APIProfileUpdate) -> Dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if "api_key" in data:
        key = data["api_key"]
        data["api_key"] = key.strip() if isinstance(key, str) and key.strip() else None
    return data


def _normalize_session_preset_or_422(raw_preset: Any) -> Dict[str, Any]:
    try:
        return normalize_session_preset(raw_preset)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def _validate_session_worldbooks(
    db: Session,
    *,
    legacy_worldbook_id: Optional[str],
    preset: Dict[str, Any],
) -> None:
    try:
        worldbook_ids = unique_worldbook_ids(legacy_worldbook_id, preset)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    missing = [worldbook_id for worldbook_id in worldbook_ids if db.get(models.WorldBook, worldbook_id) is None]
    if missing:
        raise HTTPException(status_code=422, detail={"message": "Unknown worldbook ids", "worldbook_ids": missing})


@router.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@router.get("/api-profiles", response_model=List[schemas.APIProfileOut])
def list_api_profiles(db: Session = Depends(get_db)) -> List[models.APIProfile]:
    return list(db.scalars(select(models.APIProfile).order_by(models.APIProfile.created_at.desc())))


@router.post("/api-profiles", response_model=schemas.APIProfileOut)
def create_api_profile(payload: schemas.APIProfileCreate, db: Session = Depends(get_db)) -> models.APIProfile:
    profile = models.APIProfile(**_api_profile_write_data(payload))
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


@router.patch("/api-profiles/{profile_id}", response_model=schemas.APIProfileOut)
def update_api_profile(profile_id: str, payload: schemas.APIProfileUpdate, db: Session = Depends(get_db)) -> models.APIProfile:
    profile = db.get(models.APIProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="API profile not found")
    for key, value in _api_profile_write_data(payload).items():
        setattr(profile, key, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.post("/api-profiles/{profile_id}/models/refresh", response_model=schemas.ModelsRefreshOut)
async def refresh_api_profile_models(profile_id: str, db: Session = Depends(get_db)) -> schemas.ModelsRefreshOut:
    profile = db.get(models.APIProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="API profile not found")
    return schemas.ModelsRefreshOut(models=await providers.refresh_models(profile))


@router.delete("/api-profiles/{profile_id}")
def delete_api_profile(profile_id: str, db: Session = Depends(get_db)) -> Dict[str, bool]:
    profile = db.get(models.APIProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="API profile not found")
    db.execute(update(models.ChatSession).where(models.ChatSession.api_profile_id == profile.id).values(api_profile_id=None))
    db.execute(update(models.GenerationRun).where(models.GenerationRun.api_profile_id == profile.id).values(api_profile_id=None))
    db.delete(profile)
    db.commit()
    return {"ok": True}


@router.get("/settings/prompt", response_model=schemas.GlobalPromptConfigOut)
def get_global_prompt_config(db: Session = Depends(get_db)) -> schemas.GlobalPromptConfigOut:
    slots, revision, updated_at, error = global_prompt_state(db)
    if error:
        raise HTTPException(status_code=500, detail=f"全局 Prompt 配置损坏：{error}")
    return schemas.GlobalPromptConfigOut(
        prompt_slots=slots,
        revision=revision,
        updated_at=updated_at,
    )


@router.put("/settings/prompt", response_model=schemas.GlobalPromptConfigOut)
def update_global_prompt_config(
    payload: schemas.GlobalPromptConfigUpdate,
    db: Session = Depends(get_db),
) -> schemas.GlobalPromptConfigOut:
    try:
        row = save_global_prompt_config(
            db,
            raw_slots=payload.prompt_slots,
            expected_revision=payload.expected_revision,
        )
    except PromptConfigConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return schemas.GlobalPromptConfigOut(
        prompt_slots=row.prompt_slots,
        revision=row.revision,
        updated_at=row.updated_at,
    )


@router.get("/characters", response_model=List[schemas.CharacterSummaryOut])
def list_characters(db: Session = Depends(get_db)) -> List[models.Character]:
    return list(db.scalars(select(models.Character).order_by(models.Character.updated_at.desc())))


@router.post("/characters", response_model=schemas.CharacterOut)
def create_character(payload: schemas.CharacterCreate, db: Session = Depends(get_db)) -> models.Character:
    character = models.Character(**_character_create_data(payload))
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@router.post("/characters/import", response_model=schemas.CharacterOut)
async def import_character(file: UploadFile = File(...), db: Session = Depends(get_db)) -> models.Character:
    payload = st_import.load_character_upload(file.filename or "character.json", await file.read())
    character = models.Character(**_character_create_data(payload))
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@router.post("/characters/import/chub", response_model=schemas.CharacterOut)
async def import_chub_character(payload: schemas.ChubImportRequest, db: Session = Depends(get_db)) -> models.Character:
    character_payload = await chub_import.import_chub_character(payload.url_or_path)
    character = models.Character(**_character_create_data(character_payload))
    db.add(character)
    db.commit()
    db.refresh(character)
    return character


@router.get("/characters/{character_id}", response_model=schemas.CharacterOut)
def get_character(character_id: str, db: Session = Depends(get_db)) -> models.Character:
    character = db.get(models.Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    return character


@router.patch("/characters/{character_id}", response_model=schemas.CharacterOut)
def update_character(character_id: str, payload: schemas.CharacterUpdate, db: Session = Depends(get_db)) -> models.Character:
    character = db.get(models.Character, character_id)
    if not character:
        raise HTTPException(status_code=404, detail="Character not found")
    data = payload.model_dump(exclude_unset=True)
    if "avatar_data_url" in data and "avatar_original_data_url" not in data and character.avatar_original_data_url is None:
        character.avatar_original_data_url = character.avatar_data_url or data["avatar_data_url"]
    for key, value in data.items():
        setattr(character, key, value)
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
    db.execute(update(models.ChatSession).where(models.ChatSession.character_id == character.id).values(character_id=None))
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
    payload = st_import.load_worldbook_upload(await file.read(), filename=file.filename)
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
            "entries": [_export_worldbook_entry(entry) for entry in worldbook.entries],
        }
    )
    return JSONResponse(data)


def _export_worldbook_entry(entry: models.WorldBookEntry) -> Dict[str, Any]:
    """Preserve unknown imported fields while current normalized edits win."""

    data = dict(entry.raw_json or {})
    data.update(
        {
            "uid": entry.uid,
            "key": list(entry.keys or []),
            "keys": list(entry.keys or []),
            "keysecondary": list(entry.secondary_keys or []),
            "secondary_keys": list(entry.secondary_keys or []),
            "content": entry.content,
            "enabled": entry.enabled,
            "disable": not entry.enabled,
            "constant": entry.constant,
            "selective": entry.selective,
            "insertion_order": entry.order,
            "order": entry.order,
            "position": entry.position,
            "depth": entry.depth,
            "case_sensitive": entry.case_sensitive,
            "match_whole_words": entry.match_whole_words,
        }
    )
    return data


@router.delete("/worldbooks/{worldbook_id}")
def delete_worldbook(worldbook_id: str, db: Session = Depends(get_db)) -> Dict[str, bool]:
    worldbook = db.get(models.WorldBook, worldbook_id)
    if not worldbook:
        raise HTTPException(status_code=404, detail="Worldbook not found")
    for session in db.scalars(select(models.ChatSession)):
        preset = dict(session.preset or {})
        configured = preset.get("worldbook_ids")
        configured_ids = configured if isinstance(configured, list) else []
        remaining = [item for item in configured_ids if item != worldbook.id]
        if remaining != configured_ids:
            preset["worldbook_ids"] = remaining
            session.preset = preset
            session.last_activity_at = models.utc_now()
        if session.worldbook_id == worldbook.id:
            session.worldbook_id = None
    db.delete(worldbook)
    db.commit()
    return {"ok": True}


@router.get("/session-folders", response_model=List[schemas.SessionFolderOut])
def list_session_folders(db: Session = Depends(get_db)) -> List[models.SessionFolder]:
    return list(db.scalars(select(models.SessionFolder).order_by(models.SessionFolder.sort_order, models.SessionFolder.name)))


@router.post("/session-folders", response_model=schemas.SessionFolderOut)
def create_session_folder(payload: schemas.SessionFolderCreate, db: Session = Depends(get_db)) -> models.SessionFolder:
    folder = models.SessionFolder(**payload.model_dump())
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder


@router.patch("/session-folders/{folder_id}", response_model=schemas.SessionFolderOut)
def update_session_folder(folder_id: str, payload: schemas.SessionFolderUpdate, db: Session = Depends(get_db)) -> models.SessionFolder:
    folder = db.get(models.SessionFolder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    _update_model(folder, payload)
    db.commit()
    db.refresh(folder)
    return folder


@router.delete("/session-folders/{folder_id}")
def delete_session_folder(folder_id: str, db: Session = Depends(get_db)) -> Dict[str, bool]:
    folder = db.get(models.SessionFolder, folder_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    db.execute(update(models.ChatSession).where(models.ChatSession.folder_id == folder.id).values(folder_id=None))
    db.delete(folder)
    db.commit()
    return {"ok": True}


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
    _validate_session_worldbooks(db, legacy_worldbook_id=data.get("worldbook_id"), preset=data["preset"])
    if data.get("active_root_child_id") is not None:
        raise HTTPException(status_code=400, detail="A new session cannot select an existing message")
    session = models.ChatSession(**data)
    try:
        db.add(session)
        db.flush()
        character = db.get(models.Character, session.character_id) if session.character_id else None
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
def context_preview(session_id: str, db: Session = Depends(get_db)) -> schemas.ContextPreviewOut:
    session = get_session_or_404(db, session_id)
    return build_context(db, session)


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


@router.post("/sessions/{session_id}/generate/stream")
async def generate_stream(
    session_id: str,
    payload: schemas.GenerateRequest,
    db: Session = Depends(get_db),
) -> StreamingResponse:
    session = get_session_or_404(db, session_id)
    if not session.api_profile:
        raise HTTPException(status_code=400, detail="Session has no API profile")

    profile = session.api_profile
    path = active_path(db, session)
    parent_id = path[-1].id if path else None
    context_path = path
    if payload.regenerate_message_id:
        base = get_message_or_404(db, payload.regenerate_message_id)
        if base.session_id != session.id:
            raise HTTPException(status_code=400, detail="Message belongs to another session")
        if base.role != "assistant":
            raise HTTPException(status_code=400, detail="Only assistant messages can be regenerated")
        parent_id = base.parent_id
        context_path = ancestor_path(db, base, include_self=False)

    context = build_context(db, session, path_override=context_path)
    compilation_errors = prompt_errors(context)
    if compilation_errors:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Prompt compilation failed",
                "diagnostics": [item.model_dump(mode="json") for item in compilation_errors],
            },
        )
    snapshot, prompt_hash = _prompt_snapshot(context)
    estimated_input_tokens = _estimate_context_tokens(context, profile.model)
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
        parameters=dict(profile.default_params or {}),
        prompt_snapshot=snapshot,
        prompt_hash=prompt_hash,
        status="streaming",
        started_at=started_at,
        input_tokens=estimated_input_tokens,
        usage_source="estimated",
    )
    db.add(generation_run)
    db.flush()
    assistant_message.provider_metadata = {
        **dict(assistant_message.provider_metadata or {}),
        "generation_run_id": generation_run.id,
        "api_profile_id": profile.id,
        "provider_type": profile.provider_type,
        "model": profile.model,
        "parameters": dict(profile.default_params or {}),
        "prompt_hash": prompt_hash,
    }
    db.commit()
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
            thinking_tokens = reported_reasoning_tokens or estimated_thinking_tokens
            provider_input_tokens = input_tokens_from_usage(usage)
            provider_output_tokens = output_tokens_from_usage(usage)
            output_tokens = provider_output_tokens
            if output_tokens is None:
                output_tokens = text_tokens + thinking_tokens
            input_tokens = provider_input_tokens if provider_input_tokens is not None else estimated_input_tokens
            cached_input_tokens = cached_tokens_from_usage(usage)
            duration_seconds = max(time.monotonic() - started_monotonic, 0.0)
            tokens_per_second = output_tokens / duration_seconds if duration_seconds > 0 else 0.0
            if provider_input_tokens is not None and provider_output_tokens is not None:
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
            yield _json_event("message_created", schemas.MessageOut.model_validate(assistant_message).model_dump(mode="json"))
            async for event in providers.stream_completion(profile, context):
                if isinstance(event, str):
                    full_text += event
                    if event and first_token_at is None:
                        first_token_at = models.utc_now()
                    dirty = True
                    yield _json_event("token", {"message_id": assistant_message_id, "delta": event})
                elif event.kind == "thinking":
                    thinking_text += event.delta
                    if event.delta and first_token_at is None:
                        first_token_at = models.utc_now()
                    dirty = True
                    yield _json_event("thinking", {"message_id": assistant_message_id, "delta": event.delta})
                elif event.kind == "text":
                    full_text += event.delta
                    if event.delta and first_token_at is None:
                        first_token_at = models.utc_now()
                    dirty = True
                    yield _json_event("token", {"message_id": assistant_message_id, "delta": event.delta})
                elif event.kind == "usage":
                    usage = merge_usage(usage, event.usage)
                    dirty = True
                    yield _json_event("usage", {"message_id": assistant_message_id, "usage": usage})
                # Batch-commit: flush dirty state periodically instead of every token
                now = time.monotonic()
                if dirty and now - last_commit >= COMMIT_INTERVAL:
                    persist_state("streaming", None, terminal=False)
                    dirty = False
                    last_commit = now
            completed_message = persist_state("complete", None, terminal=True)
            yield _json_event("message_completed", schemas.MessageOut.model_validate(completed_message).model_dump(mode="json"))
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
            yield _json_event(
                "error",
                {"message_id": assistant_message_id, "detail": detail, "message": message_data},
            )
        except BaseException as exc:
            persist_state("interrupted", str(exc) or "Generation interrupted", terminal=True)
            raise

    return StreamingResponse(events(), media_type="text/event-stream")
