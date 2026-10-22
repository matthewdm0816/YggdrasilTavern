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


def test_global_worldbook_regex_migration_takes_latest_session_values(tmp_path, monkeypatch):
    database_path = tmp_path / "worldbook-regex.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "0007_sillytavern_import")
    engine = create_engine(database_url)
    old_rule = {"id": "old-rule", "pattern": "a", "replacement": "b", "targets": ["display"], "mode": "replace"}
    try:
        with Session(engine, expire_on_commit=False) as db:
            old_book = models.WorldBook(name="Old")
            new_book = models.WorldBook(name="New")
            db.add_all([old_book, new_book])
            db.flush()
            older = models.ChatSession(
                title="Older", preset={"worldbook_ids": [old_book.id], "regex_rules": [old_rule]},
            )
            newer = models.ChatSession(
                title="Newer", worldbook_id=new_book.id, preset={"worldbook_ids": ["deleted-book"], "regex_rules": []},
            )
            db.add_all([older, newer])
            db.commit()
            db.execute(text("UPDATE sessions SET updated_at = '2026-01-01 00:00:00' WHERE id = :id"), {"id": older.id})
            db.execute(text("UPDATE sessions SET updated_at = '2026-02-01 00:00:00' WHERE id = :id"), {"id": newer.id})
            db.commit()
            new_book_id, newer_id = new_book.id, newer.id
        command.upgrade(config, "head")
        with Session(engine) as db:
            shared = db.get(models.GlobalWorldbookRegexConfig, "default")
            # Each value comes from the latest session that has one; unknown worldbook ids are dropped.
            assert shared.worldbook_ids == [new_book_id]
            assert shared.regex_rules == [old_rule]
            assert shared.revision == 1
            assert db.get(models.ChatSession, newer_id).preset["worldbook_ids"] == ["deleted-book"]
    finally:
        engine.dispose()


def test_tts_migration_preserves_existing_chat_and_leaves_speech_disabled(tmp_path, monkeypatch):
    database_url = f"sqlite:///{(tmp_path / 'tts-migration.db').as_posix()}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "0008_global_worldbook_regex")
    engine = create_engine(database_url)
    try:
        with Session(engine, expire_on_commit=False) as db:
            session = models.ChatSession(title="Preserved chat")
            db.add(session)
            db.flush()
            message = models.Message(session_id=session.id, role="assistant", content="Original content")
            db.add(message)
            db.commit()
            session_id, message_id = session.id, message.id
        command.upgrade(config, "head")
        with Session(engine) as db:
            assert db.get(models.ChatSession, session_id).title == "Preserved chat"
            assert db.get(models.Message, message_id).content == "Original content"
            assert db.get(models.TtsSettings, "default") is None
            db.add(models.TtsSettings())
            db.commit()
            settings = db.get(models.TtsSettings, "default")
            assert settings.enabled is False
            assert settings.trigger_mode == "manual"
            assert settings.api_key is None
        with engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        command.downgrade(config, "0008_global_worldbook_regex")
        assert "tts_settings" not in inspect(engine).get_table_names()
        with Session(engine) as db:
            assert db.get(models.Message, message_id).content == "Original content"
    finally:
        engine.dispose()
