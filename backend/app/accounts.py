"""Account registry and database selection. Resource IDs never select a user's database."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import unicodedata
from pathlib import Path
from threading import RLock
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import Boolean, Column, ForeignKey, Integer, MetaData, String, Table, delete, insert, select, update
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError

from .config import Settings
from .database import Database, create_database_engine


metadata = MetaData()
users = Table(
    "users", metadata,
    Column("id", String, primary_key=True),
    Column("username", String, nullable=False),
    Column("username_key", String, nullable=False, unique=True),
    Column("display_name", String, nullable=False),
    Column("password_hash", String, nullable=False),
    Column("is_admin", Boolean, nullable=False),
    Column("is_owner", Boolean, nullable=False),
    Column("active", Boolean, nullable=False),
    Column("credential_version", Integer, nullable=False),
)
sessions = Table(
    "login_sessions", metadata,
    Column("token_hash", String, primary_key=True),
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("expires_at", Integer, nullable=False),
    Column("credential_version", Integer, nullable=False),
)


def username_key(value: str) -> str:
    return unicodedata.normalize("NFKC", value.strip()).casefold()


def hash_password(password: str, salt: str | None = None) -> str:
    # OWASP's 16 MiB scrypt configuration; random salt per password.
    salt = salt or secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt), n=2**14, r=8, p=5)
    return f"scrypt:16384:8:5${salt}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    algorithm, salt, _digest = encoded.split("$")
    if algorithm != "scrypt:16384:8:5":
        raise RuntimeError("Unsupported account password hash; account registry requires migration")
    return hmac.compare_digest(hash_password(password, salt), encoded)


def public_user(user: dict) -> dict:
    return {key: user[key] for key in ("id", "username", "display_name", "is_admin", "active", "is_owner")}


class Accounts:
    def __init__(self, settings: Settings, owner_database: Database):
        self.settings = settings
        self.owner_database = owner_database
        url = make_url(owner_database.database_url)
        self.supported = url.get_backend_name() == "sqlite"
        self.directory = (
            Path(url.database).resolve().with_name(Path(url.database).name + ".users")
            if self.supported and url.database not in (None, "", ":memory:") else None
        )
        self._engine = None
        self._workspaces: dict[str, Database] = {}
        self._lock = RLock()
        self._dummy_hash: str | None = None
        self._attempts: dict[str, list[float]] = {}

    def initialize(self) -> None:
        with self._lock:
            if self._engine is not None:
                return
            exists = self.directory is not None and (self.directory / "accounts.db").exists()
            if not self.settings.auth_enabled and not exists:
                return
            self._open_registry()
            with self._engine.begin() as connection:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                if connection.scalar(select(users.c.id).limit(1)) is None:
                    if not self.settings.auth_enabled:
                        return
                    connection.execute(insert(users).values(**self._new_user(
                        self.settings.auth_username,
                        self.settings.auth_password.get_secret_value(),
                        self.settings.auth_username, is_admin=True, is_owner=True,
                    )))

    def _open_registry(self) -> None:
        if not self.supported:
            raise RuntimeError("Multi-user profiles require a SQLite database")
        if self._engine is not None:
            return
        if self.directory is not None:
            self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
            url = make_url("sqlite://").set(database=str(self.directory / "accounts.db"))
        else:
            url = "sqlite:///:memory:"
        engine = create_database_engine(str(url))
        try:
            metadata.create_all(engine)
            if self.directory is not None:
                (self.directory / "accounts.db").chmod(0o600)
        except Exception:
            engine.dispose()
            raise
        self._engine = engine

    @property
    def enabled(self) -> bool:
        self.initialize()
        if self._engine is None:
            return False
        with self._engine.connect() as connection:
            return connection.scalar(select(users.c.id).limit(1)) is not None

    def _new_user(self, username: str, password: str, display_name: str, *, is_admin=False, is_owner=False) -> dict:
        return dict(id=str(uuid4()), username=username.strip(), username_key=username_key(username),
                    display_name=display_name.strip() or username.strip(), password_hash=hash_password(password),
                    is_admin=is_admin, is_owner=is_owner, active=True, credential_version=1)

    def setup(self, username: str, password: str, display_name: str) -> dict:
        with self._lock:
            self._open_registry()
            with self._engine.begin() as connection:
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                if connection.scalar(select(users.c.id).limit(1)) is not None:
                    raise HTTPException(409, "多用户登录已经启用，请登录现有账号")
                user = self._new_user(username, password, display_name, is_admin=True, is_owner=True)
                try:
                    connection.execute(insert(users).values(**user))
                except IntegrityError as exc:
                    raise HTTPException(409, "账号已存在") from exc
            return user

    def list_users(self) -> list[dict]:
        with self._engine.connect() as connection:
            return [public_user(dict(row)) for row in connection.execute(select(users).order_by(users.c.username)).mappings()]

    def create_user(self, username: str, password: str, display_name: str) -> dict:
        user = self._new_user(username, password, display_name)
        try:
            with self._engine.begin() as connection:
                connection.execute(insert(users).values(**user))
        except IntegrityError as exc:
            raise HTTPException(409, "用户名已存在") from exc
        return public_user(user)

    def check_login(self, username: str, password: str, address: str) -> dict | None:
        with self._lock:
            now = time.monotonic()
            self._attempts = {key: [t for t in attempts if t > now - 300]
                              for key, attempts in self._attempts.items() if attempts and attempts[-1] > now - 300}
            attempts = self._attempts.setdefault(address, [])
            if len(attempts) >= 20:
                raise HTTPException(429, "登录尝试过于频繁，请在 5 分钟后重试")
            attempts.append(now)
            with self._engine.connect() as connection:
                row = connection.execute(select(users).where(users.c.username_key == username_key(username))).mappings().first()
            if self._dummy_hash is None:
                self._dummy_hash = hash_password(secrets.token_urlsafe(32))
            valid = verify_password(password, row["password_hash"] if row else self._dummy_hash)
            if not row or not valid or not row["active"]:
                return None
            self._attempts.pop(address, None)
            return dict(row)

    def issue_session(self, user: dict) -> str:
        token = secrets.token_urlsafe(48)
        with self._engine.begin() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            current = connection.execute(select(users).where(users.c.id == user["id"])).mappings().one()
            if not current["active"] or current["credential_version"] != user["credential_version"]:
                raise HTTPException(401, "账号信息已经更改，请重新登录")
            connection.execute(delete(sessions).where(sessions.c.expires_at <= int(time.time())))
            connection.execute(insert(sessions).values(
                token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user["id"],
                expires_at=int(time.time()) + self.settings.auth_session_ttl_seconds,
                credential_version=user["credential_version"],
            ))
        return token

    def authenticate(self, token: str | None) -> dict | None:
        if not token or len(token) > 256 or not self.enabled:
            return None
        with self._engine.connect() as connection:
            row = connection.execute(select(users).join(sessions).where(
                sessions.c.token_hash == hashlib.sha256(token.encode()).hexdigest(),
                sessions.c.expires_at > int(time.time()), users.c.active.is_(True),
                sessions.c.credential_version == users.c.credential_version,
            )).mappings().first()
            return dict(row) if row else None

    def revoke_session(self, token: str | None) -> None:
        if token and self.enabled:
            with self._engine.begin() as connection:
                connection.execute(delete(sessions).where(sessions.c.token_hash == hashlib.sha256(token.encode()).hexdigest()))

    def update_user(self, user_id: str, *, display_name: str | None = None,
                    password: str | None = None, active: bool | None = None, current_password: str | None = None) -> dict:
        with self._lock, self._engine.begin() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            row = connection.execute(select(users).where(users.c.id == user_id)).mappings().first()
            if row is None:
                raise HTTPException(404, "用户不存在")
            if current_password is not None and not verify_password(current_password, row["password_hash"]):
                raise HTTPException(400, "当前密码错误")
            if row["is_owner"] and active is False:
                raise HTTPException(400, "不能停用首位管理员")
            values = {}
            if display_name is not None:
                values["display_name"] = display_name
            if password is not None:
                values["password_hash"] = hash_password(password)
            if active is not None:
                values["active"] = active
            if password is not None or active is False:
                values["credential_version"] = row["credential_version"] + 1
            if values:
                connection.execute(update(users).where(users.c.id == user_id).values(**values))
            if password is not None or active is False:
                connection.execute(delete(sessions).where(sessions.c.user_id == user_id))
            return {**dict(row), **values}

    def workspace(self, user: dict) -> Database:
        if user["is_owner"]:
            return self.owner_database
        user_id = str(UUID(user["id"]))
        with self._lock:
            if user_id not in self._workspaces:
                url = (str(make_url("sqlite://").set(database=str(self.directory / f"{user_id}.db")))
                       if self.directory else "sqlite:///:memory:")
                database = Database(url)
                try:
                    database.initialize()
                except Exception:
                    database.dispose()
                    raise
                self._workspaces[user_id] = database
            return self._workspaces[user_id]

    def dispose(self) -> None:
        for database in self._workspaces.values():
            database.dispose()
        self._workspaces.clear()
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None
