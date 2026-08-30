"""Small, dependency-free signed-cookie authentication for trusted LAN use."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import secrets
import time

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import Settings


AUTH_COOKIE_NAME = "yggdrasil_session"
PUBLIC_API_PATHS = frozenset(
    {
        "/api/health",
        "/api/auth/status",
        "/api/auth/login",
        "/api/auth/logout",
    }
)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str
    password: str


class AuthStatus(BaseModel):
    enabled: bool
    authenticated: bool
    username: str | None = None


def _base64url_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)


def _secret_value(settings: Settings) -> str:
    if not settings.auth_secret:
        raise RuntimeError("Authentication secret is unavailable despite authentication being enabled")
    return settings.auth_secret.get_secret_value()


def _sign(encoded_payload: str, settings: Settings) -> str:
    digest = hmac.new(
        _secret_value(settings).encode("utf-8"),
        encoded_payload.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return _base64url_encode(digest)


def _constant_time_text_equal(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def create_session_token(settings: Settings, *, now: int | None = None) -> str:
    if not settings.auth_enabled or not settings.auth_username:
        raise RuntimeError("Cannot create an authentication session while authentication is disabled")
    issued_at = int(time.time()) if now is None else now
    payload = {
        "v": 1,
        "sub": settings.auth_username,
        "iat": issued_at,
        "exp": issued_at + settings.auth_session_ttl_seconds,
        "nonce": secrets.token_urlsafe(18),
    }
    encoded_payload = _base64url_encode(
        json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("utf-8")
    )
    return f"{encoded_payload}.{_sign(encoded_payload, settings)}"


def authenticated_username(token: str | None, settings: Settings, *, now: int | None = None) -> str | None:
    if not settings.auth_enabled or not token:
        return None
    try:
        encoded_payload, supplied_signature = token.split(".", 1)
        expected_signature = _sign(encoded_payload, settings)
        if not hmac.compare_digest(supplied_signature, expected_signature):
            return None
        payload = json.loads(_base64url_decode(encoded_payload))
    except (binascii.Error, UnicodeError, ValueError, TypeError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None
    version = payload.get("v")
    username = payload.get("sub")
    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    nonce = payload.get("nonce")
    if version != 1 or not isinstance(username, str) or not isinstance(nonce, str) or not nonce:
        return None
    if type(issued_at) is not int or type(expires_at) is not int:
        return None

    current_time = int(time.time()) if now is None else now
    if issued_at > current_time + 60 or expires_at <= current_time or expires_at <= issued_at:
        return None
    if expires_at - issued_at != settings.auth_session_ttl_seconds:
        return None
    if not settings.auth_username or not _constant_time_text_equal(username, settings.auth_username):
        return None
    return username


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


def _status_payload(settings: Settings, username: str | None) -> AuthStatus:
    if not settings.auth_enabled:
        return AuthStatus(enabled=False, authenticated=True, username=None)
    return AuthStatus(enabled=True, authenticated=username is not None, username=username)


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/status", response_model=AuthStatus)
def auth_status(request: Request, response: Response) -> AuthStatus:
    settings = _settings(request)
    token = request.cookies.get(AUTH_COOKIE_NAME)
    username = authenticated_username(token, settings)
    if settings.auth_enabled and token and username is None:
        clear_session_cookie(response, settings)
    return _status_payload(settings, username)


@router.post("/login", response_model=AuthStatus)
def login(payload: LoginRequest, request: Request, response: Response) -> AuthStatus | JSONResponse:
    settings = _settings(request)
    if not settings.auth_enabled:
        clear_session_cookie(response, settings)
        return _status_payload(settings, None)

    configured_username = settings.auth_username or ""
    configured_password = settings.auth_password.get_secret_value() if settings.auth_password else ""
    username_matches = _constant_time_text_equal(payload.username, configured_username)
    password_matches = _constant_time_text_equal(payload.password, configured_password)
    if not (username_matches and password_matches):
        failure = JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Invalid username or password"},
        )
        clear_session_cookie(failure, settings)
        return failure

    token = create_session_token(settings)
    _set_session_cookie(response, token, settings)
    return _status_payload(settings, configured_username)


@router.post("/logout", response_model=AuthStatus)
def logout(request: Request, response: Response) -> AuthStatus:
    settings = _settings(request)
    clear_session_cookie(response, settings)
    return _status_payload(settings, None)


class AuthenticationMiddleware:
    """Protect all application APIs without buffering streaming responses."""

    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.settings = settings

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not self.settings.auth_enabled:
            await self.app(scope, receive, send)
            return

        path = str(scope.get("path", ""))
        method = str(scope.get("method", "GET")).upper()
        if not path.startswith("/api") or path in PUBLIC_API_PATHS or method == "OPTIONS":
            await self.app(scope, receive, send)
            return

        request = Request(scope)
        token = request.cookies.get(AUTH_COOKIE_NAME)
        username = authenticated_username(token, self.settings)
        if username is None:
            response = JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": "Authentication required"},
            )
            if token:
                clear_session_cookie(response, self.settings)
            await response(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        state["auth_username"] = username
        await self.app(scope, receive, send)
