from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import chub_import, st_import

router = APIRouter()

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
