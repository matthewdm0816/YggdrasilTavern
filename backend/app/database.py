from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


settings = get_settings()
engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    if settings.database_url.startswith("sqlite"):
        _ensure_sqlite_columns()


def _ensure_sqlite_columns() -> None:
    inspector = inspect(engine)
    if "messages" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("messages")}
    statements = []
    if "thinking_content" not in columns:
        statements.append("ALTER TABLE messages ADD COLUMN thinking_content TEXT NOT NULL DEFAULT ''")
    if "token_count" not in columns:
        statements.append("ALTER TABLE messages ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0")
    if "thinking_token_count" not in columns:
        statements.append("ALTER TABLE messages ADD COLUMN thinking_token_count INTEGER NOT NULL DEFAULT 0")
    if "cached_tokens" not in columns:
        statements.append("ALTER TABLE messages ADD COLUMN cached_tokens INTEGER NOT NULL DEFAULT 0")
    if not statements:
        return
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
