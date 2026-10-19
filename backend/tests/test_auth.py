import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.auth import AUTH_COOKIE_NAME
from app.config import Settings
from app.main import create_app
from app.database import Database


AUTH_VALUES = {
    "auth_enabled": True,
    "auth_username": "owner",
    "auth_password": "correct horse battery staple",
    "auth_secret": "0123456789abcdef0123456789abcdef",
    "auth_session_ttl_seconds": 3600,
}


def settings(**overrides) -> Settings:
    return Settings(_env_file=None, **{**AUTH_VALUES, **overrides})


def app_with_probe(app_settings: Settings):
    app = create_app(init_on_startup=False, settings=app_settings, database=Database("sqlite:///:memory:"))

    @app.get("/api/private-probe")
    def private_probe():
        return {"ok": True}

    return app


def test_auth_is_disabled_by_default_and_does_not_block_api():
    app_settings = Settings(_env_file=None)
    client = TestClient(app_with_probe(app_settings))

    assert client.get("/api/auth/status").json() == {
        "enabled": False,
        "authenticated": True,
        "username": None,
        "user": None,
        "can_setup": True,
    }
    assert client.get("/api/private-probe").json() == {"ok": True}
    assert client.get("/api/private-probe").headers["cache-control"] == "no-store"


def test_enabled_auth_login_status_protection_and_logout():
    client = TestClient(app_with_probe(settings()))

    assert client.get("/api/health").status_code == 200
    assert client.get("/api/auth/status").json() == {
        "enabled": True,
        "authenticated": False,
        "username": None,
        "user": None,
        "can_setup": False,
    }
    protected = client.get("/api/private-probe", headers={"Origin": "http://localhost:5173"})
    assert protected.status_code == 401
    assert protected.json() == {"detail": "Authentication required"}
    assert protected.headers["access-control-allow-origin"] == "http://localhost:5173"

    bad_login = client.post(
        "/api/auth/login",
        json={"username": "owner", "password": "wrong"},
    )
    assert bad_login.status_code == 401
    assert bad_login.json() == {"detail": "Invalid username or password"}

    login = client.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse battery staple"},
    )
    assert login.status_code == 200
    assert login.json()["authenticated"] is True
    assert login.json()["user"]["username"] == "owner"
    assert login.json()["user"]["is_admin"] is True
    cookie_header = login.headers["set-cookie"].lower()
    assert f"{AUTH_COOKIE_NAME}=" in cookie_header
    assert "httponly" in cookie_header
    assert "samesite=lax" in cookie_header
    assert "path=/" in cookie_header
    assert "secure" not in cookie_header

    assert client.get("/api/private-probe").json() == {"ok": True}
    assert client.get("/api/auth/status").json()["authenticated"] is True

    logout = client.post("/api/auth/logout")
    assert logout.json() == {"enabled": True, "authenticated": False, "username": None, "user": None, "can_setup": False}
    assert client.get("/api/private-probe").status_code == 401


def test_tampered_and_expired_session_cookies_are_rejected():
    from sqlalchemy import update
    from app.accounts import sessions

    app = app_with_probe(settings())
    client = TestClient(app)
    client.post('/api/auth/login', json={'username': 'owner', 'password': 'correct horse battery staple'})
    token = client.cookies.get(AUTH_COOKIE_NAME)
    replacement = 'A' if token[-1] != 'A' else 'B'
    client.cookies.set(AUTH_COOKIE_NAME, token[:-1] + replacement)
    response = client.get('/api/private-probe')
    assert response.status_code == 401
    assert AUTH_COOKIE_NAME in response.headers.get('set-cookie', '')

    client.cookies.clear()
    client.cookies.set(AUTH_COOKIE_NAME, token)
    with app.state.accounts._engine.begin() as connection:
        connection.execute(update(sessions).values(expires_at=1))
    assert client.get('/api/private-probe').status_code == 401
    client.cookies.set(AUTH_COOKIE_NAME, '%%%not-a-session%%%')
    assert client.get('/api/auth/status').json()['authenticated'] is False


def test_unicode_credentials_are_supported():
    app_settings = settings(auth_username="主人", auth_password="只有本地知道的足够长密码")
    client = TestClient(app_with_probe(app_settings))
    response = client.post(
        "/api/auth/login",
        json={"username": "主人", "password": "只有本地知道的足够长密码"},
    )
    assert response.status_code == 200
    assert response.json()["username"] == "主人"
    assert client.get("/api/private-probe").status_code == 200


def test_secure_cookie_setting_is_honored():
    client = TestClient(app_with_probe(settings(auth_cookie_secure=True)), base_url="https://testserver")
    response = client.post(
        "/api/auth/login",
        json={"username": "owner", "password": "correct horse battery staple"},
    )
    assert response.status_code == 200
    assert "secure" in response.headers["set-cookie"].lower()


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"auth_username": None}, "YGGDRASIL_AUTH_USERNAME"),
        ({"auth_password": None}, "YGGDRASIL_AUTH_PASSWORD"),
        ({"auth_secret": None}, "YGGDRASIL_AUTH_SECRET"),
        ({"auth_password": "too-short"}, "at least 12 characters"),
        ({"auth_secret": "too-short"}, "at least 32 UTF-8 bytes"),
    ],
)
def test_enabled_auth_rejects_incomplete_or_weak_configuration(overrides, expected):
    with pytest.raises(ValidationError, match=expected):
        settings(**overrides)


def test_disabled_auth_rejects_silently_ignored_credentials():
    with pytest.raises(ValidationError, match="YGGDRASIL_AUTH_ENABLED is false"):
        Settings(_env_file=None, auth_enabled=False, auth_username="owner")


def test_yggdrasil_environment_names_are_loaded(monkeypatch):
    monkeypatch.setenv("YGGDRASIL_AUTH_ENABLED", "true")
    monkeypatch.setenv("YGGDRASIL_AUTH_USERNAME", "lan-owner")
    monkeypatch.setenv("YGGDRASIL_AUTH_PASSWORD", "lan-password")
    monkeypatch.setenv("YGGDRASIL_AUTH_SECRET", "abcdef0123456789abcdef0123456789")
    configured = Settings(_env_file=None)
    assert configured.auth_enabled is True
    assert configured.auth_username == "lan-owner"
    assert configured.auth_password and configured.auth_password.get_secret_value() == "lan-password"
