"""SillyTavern SSH preview/apply and read-only imported configuration."""

from pathlib import Path
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from ..services.st_directory_import import apply_plan, backup_sqlite, build_plan, plan_report
from ..services.st_directory_source import read_source

router = APIRouter()


@router.post("/imports/sillytavern/preview", response_model=schemas.SillyTavernImportReport)
def preview_import(payload: schemas.SillyTavernPreviewRequest, request: Request, db: Session = Depends(get_db)):
    try:
        files, manifest, source = read_source(payload.directory, ssh_host=payload.ssh_host, user=payload.user)
        plan = build_plan(files, manifest, source)
        report = plan_report(plan, db)
    except (ValueError, TypeError, KeyError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if report["can_apply"]:
        with request.app.state.st_import_lock:
            staged = request.app.state.st_import_plans
            now = time.monotonic()
            for token in list(staged):
                if staged[token][0] <= now:
                    del staged[token]
            if len(staged) >= 4:
                raise HTTPException(status_code=429, detail="已有 4 个导入预览待处理，请先完成导入或等待 15 分钟后重试")
            token = secrets.token_urlsafe(32)
            row = db.get(models.GlobalPromptConfig, "default")
            staged[token] = (now + 900, plan, row.revision if row else 0)
            report["token"] = token
    return report


@router.post("/imports/sillytavern/apply", response_model=schemas.SillyTavernImportReport)
def commit_import(payload: schemas.SillyTavernApplyRequest, request: Request, db: Session = Depends(get_db)):
    with request.app.state.st_import_lock:
        staged = request.app.state.st_import_plans.pop(payload.token, None)
        if staged is None or staged[0] <= time.monotonic():
            raise HTTPException(status_code=410, detail="导入预览已使用或超过 15 分钟，请重新预览")
        _, plan, revision = staged
        row = db.get(models.GlobalPromptConfig, "default")
        if payload.activate and (row.revision if row else 0) != revision:
            raise HTTPException(status_code=409, detail="预览后全局提示词已被修改，请重新预览再导入")
        try:
            backup = backup_sqlite(db.get_bind(), Path(__file__).resolve().parents[3] / ".yggdrasil-runtime" / "backups")
            report = apply_plan(db, plan, activate=payload.activate, expected_prompt_revision=revision if payload.activate else None)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except (OSError, SQLAlchemyError) as exc:
            raise HTTPException(status_code=500, detail=f"导入或数据库备份失败（{type(exc).__name__}），未完成导入，请重新预览") from exc
    report["backup_path"] = str(backup) if backup else None
    return report


@router.get("/imports/resources", response_model=list[schemas.ImportedResourceOut])
def imported_resources(kind: str = "prompt", db: Session = Depends(get_db)):
    # Credential values are in their own table and never returned here.
    return list(db.scalars(select(models.ImportedResource).where(models.ImportedResource.kind == kind).order_by(models.ImportedResource.name)))


@router.get("/saved-credentials", response_model=list[schemas.SavedCredentialOut])
def saved_credentials(db: Session = Depends(get_db)):
    return list(db.scalars(select(models.SavedCredential).order_by(models.SavedCredential.name)))


@router.post("/api-profiles/{profile_id}/credential", response_model=schemas.APIProfileOut)
def bind_credential(profile_id: str, payload: schemas.BindCredentialRequest, db: Session = Depends(get_db)):
    profile = db.get(models.APIProfile, profile_id)
    credential = db.get(models.SavedCredential, payload.credential_id)
    if profile is None or credential is None:
        raise HTTPException(status_code=404, detail="API 配置或保存的密钥不存在")
    if not credential.secret_type.startswith("api_key_"):
        raise HTTPException(status_code=422, detail="该保存项不是 API Key")
    profile.api_key = credential.api_key
    profile.api_key_env = ""
    profile.model_catalog = []
    profile.models_refreshed_at = None
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/settings/session-defaults", response_model=schemas.DefaultSessionConfigOut)
def session_defaults(db: Session = Depends(get_db)):
    row = db.get(models.DefaultSessionConfig, "default")
    return schemas.DefaultSessionConfigOut(preset=row.preset, api_profile_id=row.api_profile_id) if row else schemas.DefaultSessionConfigOut()
