from __future__ import annotations

from typing import Dict, List

import httpx

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services import providers
from ..services.errors import ApplicationError
from ._shared import api_profile_write_data as _api_profile_write_data

router = APIRouter()


async def discover_profile_models(profile: models.APIProfile) -> schemas.ModelsRefreshOut:
    try:
        discovered = await providers.refresh_models(profile)
    except ApplicationError as exc:
        return schemas.ModelsRefreshOut(
            models=[], available=False,
            message=f"无法获取模型列表：{exc.detail}。仍可手动填写模型名称。",
        )
    except (httpx.InvalidURL, ValueError):
        return schemas.ModelsRefreshOut(models=[], available=False, message="无法获取模型列表：服务地址或返回的模型信息格式无效；请检查 Base URL，也可手动填写模型名称。")
    return schemas.ModelsRefreshOut(models=discovered, refreshed_at=models.utc_now())


@router.post("/api-profiles/models/discover", response_model=schemas.ModelsRefreshOut)
async def discover_api_profile_models(payload: schemas.ModelsDiscoverIn, db: Session = Depends(get_db)) -> schemas.ModelsRefreshOut:
    stored = db.get(models.APIProfile, payload.profile_id) if payload.profile_id else None
    key = (payload.api_key or "").strip()
    key_env = ""
    if not key and stored:
        if (payload.provider_type, payload.base_url.rstrip("/"), payload.path_override or None) != (
            stored.provider_type, stored.base_url.rstrip("/"), stored.path_override or None
        ):
            return schemas.ModelsRefreshOut(models=[], available=False, message="连接地址或协议已更改，请重新输入 API Key 后获取模型列表；仍可手动填写模型名称。")
        key, key_env = stored.api_key, stored.api_key_env
    profile = models.APIProfile(
        name="模型列表预览", provider_type=payload.provider_type, base_url=payload.base_url,
        path_override=payload.path_override, model="", api_key=key, api_key_env=key_env,
        default_params=stored.default_params if stored else {},
    )
    return await discover_profile_models(profile)

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
    credential_changed = any(field in data and data[field] != getattr(profile, field) for field in ("api_key", "api_key_env"))
    if routing_changed or credential_changed:
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
    connection = {field: getattr(profile, field) for field in ("provider_type", "base_url", "path_override", "api_key", "api_key_env")}
    result = await discover_profile_models(profile)
    if not result.available:
        return result
    saved = db.execute(update(models.APIProfile).where(
        models.APIProfile.id == profile_id,
        *(getattr(models.APIProfile, field) == value for field, value in connection.items()),
    ).values(model_catalog=[item.model_dump(mode="json") for item in result.models], models_refreshed_at=result.refreshed_at))
    if saved.rowcount != 1:
        db.rollback()
        return schemas.ModelsRefreshOut(models=[], available=False, message="API 配置在获取模型列表期间已更改；请重新获取，也可手动填写模型名称。")
    db.commit()
    return result


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
