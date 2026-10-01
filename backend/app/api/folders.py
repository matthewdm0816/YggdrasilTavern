from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ._shared import update_model as _update_model

router = APIRouter()

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
