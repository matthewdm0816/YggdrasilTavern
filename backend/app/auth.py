"""Multi-user authentication with revocable, server-side login sessions."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.types import ASGIApp, Receive, Scope, Send
from starlette.datastructures import MutableHeaders

from .config import Settings
from .accounts import Accounts, public_user


AUTH_COOKIE_NAME = "yggdrasil_session"
PUBLIC_API_PATHS = frozenset(
    {
        "/api/health",
        "/api/auth/status",
        "/api/auth/login",
        "/api/auth/logout",
        "/api/auth/setup",
    }
)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=1024)


class UserOut(BaseModel):
    id: str
    username: str
    display_name: str
    is_admin: bool
    active: bool
    is_owner: bool


class UserCreate(LoginRequest):
    password: str = Field(min_length=12, max_length=1024)
    display_name: str = Field(default="", max_length=120)

    @field_validator("username")
    @classmethod
    def validate_username(cls, value: str) -> str:
        value = value.strip()
        if not value or any(ord(char) < 32 for char in value):
            raise ValueError("用户名不能为空或包含控制字符")
        return value


class UserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    password: str | None = Field(default=None, min_length=12, max_length=1024)
    active: bool | None = None


class OwnProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    display_name: str = Field(min_length=1, max_length=120)


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=1024)
    password: str = Field(min_length=12, max_length=1024)


class AuthStatus(BaseModel):
    enabled: bool
    authenticated: bool
    username: str | None = None
    user: UserOut | None = None
    can_setup: bool = False


def _set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=settings.auth_session_ttl_seconds,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        path="/",
        secure=settings.auth_cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _settings(request: Request) -> Settings:
    settings = getattr(request.app.state, "settings", None)
    if not isinstance(settings, Settings):
        raise RuntimeError("Application authentication settings were not initialized")
    return settings


def _accounts(request: Request) -> Accounts:
    return request.app.state.accounts


def current_user(request: Request) -> dict:
    user = getattr(request.state, "auth_user", None)
    if user is None:
        raise HTTPException(401, "Authentication required")
    return user


def require_admin(request: Request) -> None:
    if _accounts(request).enabled and not current_user(request)["is_admin"]:
        raise HTTPException(403, "只有管理员可以执行此操作")


def _status_payload(request: Request, user: dict | None) -> AuthStatus:
    enabled = _accounts(request).enabled
    return AuthStatus(enabled=enabled, authenticated=not enabled or user is not None,
                      username=user["username"] if user else None,
                      user=UserOut(**public_user(user)) if user else None,
                      can_setup=not enabled and _accounts(request).supported and _is_local(request))


def _is_local(request: Request) -> bool:
    return bool(request.client and request.client.host in {"127.0.0.1", "::1", "testclient"})


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatus)
def auth_status(request: Request, response: Response) -> AuthStatus:
    settings = _settings(request)
    token = request.cookies.get(AUTH_COOKIE_NAME)
    user = _accounts(request).authenticate(token)
    if _accounts(request).enabled and token and user is None:
        clear_session_cookie(response, settings)
    return _status_payload(request, user)


@router.post("/login", response_model=AuthStatus)
def login(payload: LoginRequest, request: Request, response: Response) -> AuthStatus | JSONResponse:
    settings = _settings(request)
    accounts = _accounts(request)
    if not accounts.enabled:
        clear_session_cookie(response, settings)
        return _status_payload(request, None)

    user = accounts.check_login(payload.username, payload.password, request.client.host if request.client else "unknown")
    if user is None:
        failure = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Invalid username or password"},
        )
        clear_session_cookie(failure, settings)
        return failure

    accounts.revoke_session(request.cookies.get(AUTH_COOKIE_NAME))
    token = accounts.issue_session(user)
    _set_session_cookie(response, token, settings)
    return _status_payload(request, user)


@router.post("/logout", response_model=AuthStatus)
def logout(request: Request, response: Response) -> AuthStatus:
    settings = _settings(request)
    user = _accounts(request).authenticate(request.cookies.get(AUTH_COOKIE_NAME))
    expected = request.headers.get("x-yggdrasil-user")
    if user and expected and expected != user["id"]:
        raise HTTPException(409, "账号已在其他页面切换，请重新确认登录状态", headers={"X-Yggdrasil-Account-Changed": "1"})
    _accounts(request).revoke_session(request.cookies.get(AUTH_COOKIE_NAME))
    clear_session_cookie(response, settings)
    return _status_payload(request, None)


@router.post("/setup", response_model=AuthStatus)
def setup(payload: UserCreate, request: Request, response: Response) -> AuthStatus:
    if not _is_local(request):
        raise HTTPException(403, "请从服务器本机启用多用户登录")
    accounts = _accounts(request)
    if accounts.enabled:
        raise HTTPException(409, "多用户登录已经启用")
    user = accounts.setup(payload.username, payload.password, payload.display_name)
    _set_session_cookie(response, accounts.issue_session(user), _settings(request))
    return _status_payload(request, user)


@router.patch("/profile", response_model=UserOut)
def update_own_profile(payload: OwnProfileUpdate, request: Request) -> dict:
    return _accounts(request).update_user(current_user(request)["id"], display_name=payload.display_name)


@router.post("/password", response_model=AuthStatus)
def change_password(payload: PasswordChange, request: Request, response: Response) -> AuthStatus:
    user = current_user(request)
    accounts = _accounts(request)
    user = accounts.update_user(user["id"], password=payload.password, current_password=payload.current_password)
    _set_session_cookie(response, accounts.issue_session(user), _settings(request))
    return _status_payload(request, user)


@router.get("/users", response_model=list[UserOut])
def list_users(request: Request) -> list[dict]:
    require_admin(request)
    current_user(request)
    return _accounts(request).list_users()


@router.post("/users", response_model=UserOut)
def create_user(payload: UserCreate, request: Request) -> dict:
    require_admin(request)
    current_user(request)
    return _accounts(request).create_user(payload.username, payload.password, payload.display_name)


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: str, payload: UserUpdate, request: Request) -> dict:
    require_admin(request)
    current_user(request)
    return _accounts(request).update_user(user_id, **payload.model_dump(exclude_none=True))


class AuthenticationMiddleware:
    """Protect all application APIs without buffering streaming responses."""

    def __init__(self, app: ASGIApp, settings: Settings, accounts: Accounts) -> None:
        self.app = app
        self.settings = settings
        self.accounts = accounts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = str(scope.get("path", ""))
        original_send = send

        async def send_without_cache(message):
            if path.startswith("/api") and message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await original_send(message)

        send = send_without_cache
        method = str(scope.get("method", "GET")).upper()
        request = Request(scope)
        if path.startswith("/api") and method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            allowed = {*self.settings.cors_origin_list, str(request.base_url).rstrip("/")}
            if (origin and origin not in allowed) or (not origin and request.headers.get("sec-fetch-site") == "cross-site"):
                await JSONResponse(status_code=403, content={"detail": "请求来源未获允许"})(scope, receive, send)
                return
        if not path.startswith("/api") or path in PUBLIC_API_PATHS or method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        if not self.accounts.enabled:
            await self.app(scope, receive, send)
            return
        token = request.cookies.get(AUTH_COOKIE_NAME)
        user = self.accounts.authenticate(token)
        if user is None:
            response = JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Authentication required"},
            )
            if token:
                clear_session_cookie(response, self.settings)
            await response(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        expected_user = request.headers.get("x-yggdrasil-user")
        if expected_user and expected_user != user["id"]:
            await JSONResponse(status_code=409, content={"detail": "账号已在其他页面切换，请重新登录"},
                               headers={"X-Yggdrasil-Account-Changed": "1"})(scope, receive, send)
            return
        state["auth_username"] = user["username"]
        state["auth_user"] = user
        await self.app(scope, receive, send)
