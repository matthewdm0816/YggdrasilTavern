from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .api.router import router
from .auth import AuthenticationMiddleware, router as auth_router
from .config import Settings, get_settings
from .database import Database
from .services.errors import ApplicationError


def create_app(
    init_on_startup: bool = True,
    settings: Settings | None = None,
    database: Database | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    owns_database = database is None
    database = database or Database(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            if init_on_startup:
                database.initialize()
            yield
        finally:
            if owns_database:
                database.dispose()

    app = FastAPI(title="YggdrasilTavern API", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.state.database = database

    @app.exception_handler(ApplicationError)
    async def application_error(_request: Request, exc: ApplicationError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

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

    app.include_router(auth_router)
    app.include_router(router)

    # Authentication is inner and CORS is outer so even 401 responses include
    # the browser's required cross-origin headers.  The pure ASGI auth layer
    # also leaves generation streams unbuffered.
    app.add_middleware(AuthenticationMiddleware, settings=settings)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return app


app = create_app()
