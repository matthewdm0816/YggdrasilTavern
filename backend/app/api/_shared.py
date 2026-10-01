"""Small request helpers shared by resource routers."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..services.prompt_config import normalize_session_preset, unique_worldbook_ids


def update_model(instance: Any, payload: Any) -> Any:
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(instance, key, value)
    return instance


def require_reference(db: Session, model: Any, object_id: Optional[str], label: str) -> None:
    if object_id is not None and db.get(model, object_id) is None:
        raise HTTPException(status_code=400, detail=f"{label} not found")


def validate_session_references(db: Session, data: Dict[str, Any]) -> None:
    require_reference(db, models.Character, data.get("character_id"), "Character")
    require_reference(db, models.APIProfile, data.get("api_profile_id"), "API profile")
    require_reference(db, models.WorldBook, data.get("worldbook_id"), "Worldbook")
    require_reference(db, models.SessionFolder, data.get("folder_id"), "Folder")


def character_create_data(payload: schemas.CharacterCreate) -> Dict[str, Any]:
    data = payload.model_dump()
    if data.get("avatar_original_data_url") is None and data.get("avatar_data_url"):
        data["avatar_original_data_url"] = data["avatar_data_url"]
    return data


def api_profile_write_data(payload: schemas.APIProfileCreate | schemas.APIProfileUpdate) -> Dict[str, Any]:
    data = payload.model_dump(exclude_unset=True)
    if "api_key" in data:
        key = data["api_key"]
        data["api_key"] = key.strip() if isinstance(key, str) and key.strip() else None
    return data


def normalize_session_preset_or_422(raw_preset: Any) -> Dict[str, Any]:
    try:
        return normalize_session_preset(raw_preset)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


def validate_session_worldbooks(
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
