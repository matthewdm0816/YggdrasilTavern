from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import schemas
from ..database import get_db
from ..services.prompt_config import PromptConfigConflict, global_prompt_state, save_global_prompt_config

router = APIRouter()

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
