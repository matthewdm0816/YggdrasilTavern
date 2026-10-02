"""Schema migration, legacy SQLite adoption, and restart recovery."""

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def migrate_schema(engine: Engine, database_url: str) -> None:
    from . import models  # noqa: F401
    from .database import Base

    table_names = set(inspect(engine).get_table_names())
    if not table_names or "alembic_version" in table_names:
        _upgrade_schema(engine, database_url)
    elif database_url.startswith("sqlite"):
        # Older releases owned the schema with create_all plus hand-written
        # ALTER statements and never created alembic_version. Bring that known
        # runtime shape up to the 0002 baseline, then let 0003 finish safely.
        Base.metadata.create_all(bind=engine)
        _ensure_sqlite_columns(engine)
        _upgrade_schema(engine, database_url, baseline_revision="0002_message_tokens_thinking")
    else:
        raise RuntimeError("Existing database has no Alembic revision; migrate it explicitly before startup")


def _alembic_config(database_url: str) -> Config:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    config.attributes["database_url"] = database_url
    return config


def _upgrade_schema(engine: Engine, database_url: str, *, baseline_revision: str | None = None) -> None:
    config = _alembic_config(database_url)
    with engine.connect() as connection:
        sqlite = connection.dialect.name == "sqlite"
        foreign_keys = None
        if sqlite:
            foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one()
            connection.commit()
        try:
            if sqlite:
                # Batch migrations drop and recreate referenced tables. With
                # enforcement enabled, DROP TABLE would cascade-delete messages.
                # SQLite only accepts this PRAGMA outside a transaction.
                connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
                if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() != 0:
                    raise RuntimeError("Could not suspend SQLite foreign key checks for schema migration")
                connection.commit()
            with connection.begin():
                if sqlite:
                    # sqlite3's legacy transaction mode does not BEGIN for DDL.
                    # Start explicitly so table rebuilds also roll back on error.
                    connection.exec_driver_sql("BEGIN")
                config.attributes["connection"] = connection
                if baseline_revision is not None:
                    command.stamp(config, baseline_revision)
                command.upgrade(config, "head")
                if sqlite:
                    violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchmany(10)
                    if violations:
                        details = "; ".join(
                            f"table={table}, rowid={rowid}, parent={parent}, constraint={constraint}"
                            for table, rowid, parent, constraint in violations
                        )
                        raise RuntimeError(f"SQLite migration foreign key check failed: {details}")
        finally:
            if foreign_keys is not None:
                # Restore enforcement before returning this connection to the
                # application's pool, including after any migration failure.
                try:
                    connection.rollback()
                    connection.exec_driver_sql(f"PRAGMA foreign_keys={int(foreign_keys)}")
                    if connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() != foreign_keys:
                        raise RuntimeError("Could not restore SQLite foreign key checks after schema migration")
                    connection.commit()
                except Exception:
                    connection.invalidate()
                    raise


def recover_interrupted_generations(engine: Engine) -> None:
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


def _ensure_sqlite_columns(engine: Engine) -> None:
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
