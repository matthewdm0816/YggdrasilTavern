from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app import models
from app.config import Settings
from app.database import Base, Database
from app.main import create_app


def file_settings(path: Path) -> Settings:
    return Settings(_env_file=None, database_url=f"sqlite:///{path.as_posix()}")


def generation_run(session_id: str, **values) -> models.GenerationRun:
    return models.GenerationRun(
        session_id=session_id, provider_type="openai_responses", model="test-model",
        prompt_hash="test-prompt", **values,
    )


def test_schema_export_does_not_open_or_migrate_a_database(tmp_path):
    database_path = tmp_path / "untouched.db"
    app = create_app(init_on_startup=False, settings=file_settings(database_path))
    assert "/api/sessions/{session_id}/generate/stream" in app.openapi()["paths"]
    assert not database_path.exists()


def test_application_database_configuration_is_isolated_from_other_apps_and_environment(tmp_path, monkeypatch):
    environment_path = tmp_path / "environment.db"
    monkeypatch.setenv("TREECHAT_DATABASE_URL", f"sqlite:///{environment_path.as_posix()}")
    first = create_app(settings=file_settings(tmp_path / "first.db"))
    second = create_app(settings=file_settings(tmp_path / "second.db"))
    with TestClient(first) as first_client, TestClient(second) as second_client:
        created = first_client.post("/api/characters", json={"name": "First database only"})
        assert created.status_code == 200
        assert len(first_client.get("/api/characters").json()) == 1
        assert second_client.get("/api/characters").json() == []
    assert not environment_path.exists()


def test_injected_memory_database_is_shared_between_requests_and_owned_by_caller():
    database = Database("sqlite:///:memory:")
    try:
        app = create_app(settings=Settings(_env_file=None), database=database)
        with TestClient(app) as client:
            assert client.post("/api/characters", json={"name": "Preserved"}).status_code == 200
            assert client.get("/api/characters").json()[0]["name"] == "Preserved"
        with database.open_session() as db:
            assert db.scalars(select(models.Character)).one().name == "Preserved"
    finally:
        database.dispose()


def test_single_streaming_generation_is_enforced_across_database_sessions(tmp_path):
    database = Database(f"sqlite:///{(tmp_path / 'concurrent.db').as_posix()}")
    try:
        database.initialize()
        with database.open_session() as first, database.open_session() as second:
            session = models.ChatSession(title="One session")
            other_session = models.ChatSession(title="Other session")
            first.add_all([session, other_session])
            first.commit()
            active = generation_run(session.id, status="streaming")
            first.add(active)
            first.commit()
            second.add(generation_run(session.id, status="streaming"))
            with pytest.raises(IntegrityError):
                second.commit()
            second.rollback()
            second.add(generation_run(other_session.id, status="streaming"))
            second.commit()
            active.status = "complete"
            first.commit()
            second.add(generation_run(session.id, status="streaming"))
            second.commit()
    finally:
        database.dispose()


def test_restart_recovery_preserves_partial_content_and_releases_generation_constraint(tmp_path):
    database = Database(f"sqlite:///{(tmp_path / 'recovery.db').as_posix()}")
    try:
        database.initialize()
        with database.open_session() as db:
            session = models.ChatSession(title="Recovery")
            db.add(session)
            db.flush()
            message = models.Message(
                session_id=session.id, role="assistant", status="streaming",
                content="Keep this partial reply", thinking_content="Keep this thought",
            )
            db.add(message)
            db.flush()
            run = generation_run(
                session.id, output_message_id=message.id, status="streaming",
            )
            db.add(run)
            db.commit()
            session_id, message_id, run_id = session.id, message.id, run.id
        database.initialize()
        with database.open_session() as db:
            recovered_message = db.get(models.Message, message_id)
            recovered_run = db.get(models.GenerationRun, run_id)
            assert recovered_message.content == "Keep this partial reply"
            assert recovered_message.thinking_content == "Keep this thought"
            assert recovered_message.status == recovered_run.status == "interrupted"
            assert recovered_run.completed_at is not None
            db.add(generation_run(session_id, status="streaming"))
            db.commit()
    finally:
        database.dispose()


def test_legacy_database_without_alembic_revision_is_adopted_without_duplicate_indexes(tmp_path):
    database = Database(f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}")
    try:
        # Simulate the pre-Alembic startup that created tables from ORM models.
        Base.metadata.create_all(database.engine)
        with database.open_session() as db:
            db.add(models.Character(name="Legacy character"))
            db.commit()
        database.initialize()
        with database.open_session() as db:
            assert db.scalars(select(models.Character)).one().name == "Legacy character"
    finally:
        database.dispose()
