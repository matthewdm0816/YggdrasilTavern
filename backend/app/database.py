from collections.abc import Generator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False, "timeout": 30} if settings.database_url.startswith("sqlite") else {},
)


if settings.database_url.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=30000")
        finally:
            cursor.close()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401

    table_names = set(inspect(engine).get_table_names())
    if not table_names or "alembic_version" in table_names:
        _upgrade_schema()
    elif settings.database_url.startswith("sqlite"):
        # Older releases owned the schema with create_all plus hand-written
        # ALTER statements and never created alembic_version. Bring that known
        # runtime shape up to the 0002 baseline, then let 0003 finish safely.
        Base.metadata.create_all(bind=engine)
        _ensure_sqlite_columns()
        config = _alembic_config()
        command.stamp(config, "0002_message_tokens_thinking")
        command.upgrade(config, "head")
    else:
        raise RuntimeError("Existing database has no Alembic revision; migrate it explicitly before startup")
    _recover_interrupted_generations()


def _alembic_config() -> Config:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    return config


def _upgrade_schema() -> None:
    command.upgrade(_alembic_config(), "head")


def _recover_interrupted_generations() -> None:
    table_names = set(inspect(engine).get_table_names())
    with engine.begin() as connection:
        if "messages" in table_names:
            connection.execute(
                text(
                    "UPDATE messages SET status = 'interrupted', "
                    "error = COALESCE(error, 'Generation interrupted by process restart') "
                    "WHERE status = 'streaming'"
                )
            )
        if "generation_runs" in table_names:
            connection.execute(
                text(
                    "UPDATE generation_runs SET status = 'interrupted', "
                    "error = COALESCE(error, 'Generation interrupted by process restart'), "
                    "completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) "
                    "WHERE status = 'streaming'"
                )
            )


def _ensure_sqlite_columns() -> None:
    inspector = inspect(engine)
    table_names = inspector.get_table_names()
    statements = []

    if "messages" in table_names:
        columns = {column["name"] for column in inspector.get_columns("messages")}
        if "thinking_content" not in columns:
            statements.append("ALTER TABLE messages ADD COLUMN thinking_content TEXT NOT NULL DEFAULT ''")
        if "token_count" not in columns:
            statements.append("ALTER TABLE messages ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0")
        if "thinking_token_count" not in columns:
            statements.append("ALTER TABLE messages ADD COLUMN thinking_token_count INTEGER NOT NULL DEFAULT 0")
        if "cached_tokens" not in columns:
            statements.append("ALTER TABLE messages ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0")

    if "sessions" in table_names:
        columns = {column["name"] for column in inspector.get_columns("sessions")}
        if "folder_id" not in columns:
            statements.append("ALTER TABLE sessions ADD COLUMN folder_id TEXT")
        if "pinned" not in columns:
            statements.append("ALTER TABLE sessions ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT 0")
        if "archived" not in columns:
            statements.append("ALTER TABLE sessions ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0")
        if "last_activity_at" not in columns:
            statements.append("ALTER TABLE sessions ADD COLUMN last_activity_at DATETIME")

    if "characters" in table_names:
        columns = {column["name"] for column in inspector.get_columns("characters")}
        if "avatar_original_data_url" not in columns:
            statements.append("ALTER TABLE characters ADD COLUMN avatar_original_data_url TEXT")
        if "avatar_transform" not in columns:
            statements.append("ALTER TABLE characters ADD COLUMN avatar_transform JSON NOT NULL DEFAULT '{}'")

    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
        if "sessions" in table_names:
            connection.execute(
                text(
                    "UPDATE sessions SET last_activity_at = "
                    "COALESCE(last_activity_at, updated_at, created_at, CURRENT_TIMESTAMP)"
                )
            )
