from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.router import router
from .config import get_settings
from .database import init_db


def create_app(init_on_startup: bool = True) -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if init_on_startup:
            init_db()
        yield

    app = FastAPI(title="YggdrasilTavern API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error_without_submitted_values(
        _request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        # FastAPI's default payload echoes each invalid `input`.  API Profile
        # validation may contain credentials, so only return safe diagnostics.
        detail = [
            {
                "type": item.get("type", "value_error"),
                "loc": item.get("loc", ()),
                "msg": item.get("msg", "请求内容无效"),
            }
            for item in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detail": detail})

    app.include_router(router)

    return app


app = create_app()
