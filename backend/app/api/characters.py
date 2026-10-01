from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import chub_import, st_import
from ._shared import character_create_data as _character_create_data

router = APIRouter()

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
    bound_sessions = db.scalar(
        select(func.count()).select_from(models.ChatSession).where(models.ChatSession.character_id == character.id)
    ) or 0
    if bound_sessions:
        raise HTTPException(
            status_code=409,
            detail=f"该角色仍被 {bound_sessions} 个 Chat session 使用；请先删除这些会话或改绑其他角色",
        )
    db.delete(character)
    db.commit()
    return {"ok": True}
