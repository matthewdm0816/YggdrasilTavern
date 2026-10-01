from __future__ import annotations

from typing import Dict, List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import providers
from ._shared import api_profile_write_data as _api_profile_write_data

router = APIRouter()

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
    data = _api_profile_write_data(payload)
    routing_changed = any(
        field in data and data[field] != getattr(profile, field)
        for field in ("provider_type", "base_url", "path_override")
    )
    has_existing_credential = bool(profile.api_key or profile.api_key_env)
    supplied_replacement = bool(data.get("api_key") or data.get("api_key_env"))
    if routing_changed and has_existing_credential and not supplied_replacement:
        raise HTTPException(
            status_code=422,
            detail="修改 API 协议、Base URL 或请求路径时，必须重新输入 API Key，防止旧 Key 被发送到新地址",
        )
    if routing_changed:
        data["model_catalog"] = []
        data["models_refreshed_at"] = None
    for key, value in data.items():
        setattr(profile, key, value)
    db.commit()
    db.refresh(profile)
    return profile


@router.post("/api-profiles/{profile_id}/models/refresh", response_model=schemas.ModelsRefreshOut)
async def refresh_api_profile_models(profile_id: str, db: Session = Depends(get_db)) -> schemas.ModelsRefreshOut:
    profile = db.get(models.APIProfile, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="API profile not found")
    discovered = await providers.refresh_models(profile)
    refreshed_at = models.utc_now()
    profile.model_catalog = [item.model_dump(mode="json") for item in discovered]
    profile.models_refreshed_at = refreshed_at
    db.commit()
    return schemas.ModelsRefreshOut(models=discovered, refreshed_at=refreshed_at)


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
