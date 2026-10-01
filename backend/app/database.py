"""Application-owned connections, without import-time database access."""

from collections.abc import Generator
from threading import RLock

from fastapi import Request
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


def create_database_engine(database_url: str) -> Engine:
    url = make_url(database_url)
    options = {}
    if url.get_backend_name() == "sqlite":
        options["connect_args"] = {"check_same_thread": False, "timeout": 30}
        if url.database in (None, "", ":memory:"):
            options["poolclass"] = StaticPool
    engine = create_engine(database_url, **options)
    if url.get_backend_name() == "sqlite":
        @event.listens_for(engine, "connect")
        def set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            try:
                cursor.execute("PRAGMA foreign_keys=ON")
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA busy_timeout=30000")
            finally:
                cursor.close()
    return engine


class Database:
    """One application's lazy engine and session factory.

    Constructing this object or exporting OpenAPI never opens a database.
    Each request receives its own ORM session; tests can inject another Database.
    """

    def __init__(self, database_url: str):
        self.database_url = database_url
        self._engine: Engine | None = None
        self._session_factory: sessionmaker[Session] | None = None
        self._lock = RLock()

    @property
    def engine(self) -> Engine:
        with self._lock:
            if self._engine is None:
                self._engine = create_database_engine(self.database_url)
            return self._engine

    def open_session(self) -> Session:
        with self._lock:
            if self._session_factory is None:
                self._session_factory = sessionmaker(
                    bind=self.engine, autoflush=False, expire_on_commit=False,
                )
            return self._session_factory()

    def initialize(self) -> None:
        from .database_schema import migrate_schema, recover_interrupted_generations

        migrate_schema(self.engine, self.database_url)
        recover_interrupted_generations(self.engine)

    def dispose(self) -> None:
        with self._lock:
            if self._engine is not None:
                self._engine.dispose()
                self._engine = None
                self._session_factory = None


def get_db(request: Request) -> Generator[Session, None, None]:
    database: Database = request.app.state.database
    with database.open_session() as db:
        yield db
