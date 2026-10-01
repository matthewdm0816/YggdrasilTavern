from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app import models


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def alembic_config(database_url: str, monkeypatch) -> Config:
    monkeypatch.setenv("TREECHAT_DATABASE_URL", database_url)
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


def test_generation_integrity_migration_upgrades_fresh_database(tmp_path, monkeypatch):
    database_path = tmp_path / "fresh.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    command.upgrade(alembic_config(database_url, monkeypatch), "head")

    engine = create_engine(database_url)
    inspector = inspect(engine)
    assert "generation_runs" in inspector.get_table_names()
    assert "global_prompt_config" in inspector.get_table_names()
    assert "api_key" in {column["name"] for column in inspector.get_columns("api_profiles")}
    assert {
        "input_token_limit",
        "output_token_limit",
        "model_catalog",
        "models_refreshed_at",
    }.issubset({column["name"] for column in inspector.get_columns("api_profiles")})
    assert {"folder_id", "pinned", "archived", "last_activity_at"}.issubset(
        {column["name"] for column in inspector.get_columns("sessions")}
    )
    assert {"avatar_original_data_url", "avatar_transform"}.issubset(
        {column["name"] for column in inspector.get_columns("characters")}
    )
    assert ("selected_child_id",) in {
        tuple(foreign_key["constrained_columns"])
        for foreign_key in inspector.get_foreign_keys("messages")
    }
    with engine.connect() as connection:
        prompt_row = connection.execute(
            text("SELECT revision, prompt_slots FROM global_prompt_config WHERE id = 'default'")
        ).one()
    assert prompt_row.revision == 1
    assert "history" in str(prompt_row.prompt_slots)


def test_generation_integrity_migration_accepts_runtime_drift_columns(tmp_path, monkeypatch):
    database_path = tmp_path / "drift.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "0002_message_tokens_thinking")

    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE session_folders ("
                "id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT, sort_order INTEGER NOT NULL DEFAULT 0, "
                "created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)"
            )
        )
        connection.execute(text("ALTER TABLE sessions ADD COLUMN folder_id TEXT"))
        connection.execute(text("ALTER TABLE sessions ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT 0"))
        connection.execute(text("ALTER TABLE sessions ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0"))

    command.upgrade(config, "head")
    inspector = inspect(engine)
    assert "generation_runs" in inspector.get_table_names()
    assert "last_activity_at" in {column["name"] for column in inspector.get_columns("sessions")}
    assert {"input_token_limit", "output_token_limit", "model_catalog"}.issubset(
        {column["name"] for column in inspector.get_columns("api_profiles")}
    )


def test_single_generation_migration_preserves_overlapping_partial_messages(tmp_path, monkeypatch):
    database_path = tmp_path / "overlapping.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "0005_profile_token_limits")
    engine = create_engine(database_url)
    try:
        with Session(engine, expire_on_commit=False) as db:
            session = models.ChatSession(title="Overlapping")
            other = models.ChatSession(title="Independent")
            db.add_all([session, other])
            db.flush()
            messages = [models.Message(
                session_id=session.id, role="assistant", status="streaming", content=content,
            ) for content in ("First partial", "Second partial")]
            db.add_all(messages)
            db.flush()
            runs = [models.GenerationRun(
                session_id=session.id, output_message_id=message.id, status="streaming",
                provider_type="openai_responses", model="test", prompt_hash="test",
            ) for message in messages]
            independent = models.GenerationRun(
                session_id=other.id, status="streaming", provider_type="openai_responses",
                model="test", prompt_hash="test",
            )
            db.add_all([*runs, independent])
            db.commit()
            message_ids = [message.id for message in messages]
            run_ids = [run.id for run in runs]
            independent_id = independent.id
        command.upgrade(config, "head")
        with Session(engine) as db:
            preserved = [db.get(models.Message, message_id) for message_id in message_ids]
            assert [message.content for message in preserved] == ["First partial", "Second partial"]
            assert all(message.status == "interrupted" for message in preserved)
            assert all(db.get(models.GenerationRun, run_id).status == "interrupted" for run_id in run_ids)
            assert db.get(models.GenerationRun, independent_id).status == "streaming"
        assert any(index["name"] == "uq_generation_runs_streaming_session" and index["unique"]
                   for index in inspect(engine).get_indexes("generation_runs"))
    finally:
        engine.dispose()
