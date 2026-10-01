"""Compatibility entry point that mounts the resource-specific API routers."""

from fastapi import APIRouter

from .characters import router as characters_router
from .folders import router as folders_router
from .generation import router as generation_router
from .profiles import router as profiles_router
from .prompts import router as prompts_router
from .sessions import router as sessions_router
from .worldbooks import router as worldbooks_router

router = APIRouter(prefix="/api")


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "application": "YggdrasilTavern"}


router.include_router(profiles_router)
router.include_router(prompts_router)
router.include_router(characters_router)
router.include_router(worldbooks_router)
router.include_router(folders_router)
router.include_router(sessions_router)
router.include_router(generation_router)
