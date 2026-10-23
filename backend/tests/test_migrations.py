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
    assert {"avatar_original_data_url", "avatar_transform", "avatar_thumbnail_data_url"}.issubset(
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
            # Seed the historical schema without newer ORM-only columns.
            for book_id in ("old-book", "new-book"):
                db.execute(text("INSERT INTO worldbooks (id, name, description, scan_depth, token_budget, recursive_scanning, raw_json, created_at, updated_at) VALUES (:id, :id, '', 8, 4000, 0, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"), {"id": book_id})
            older = models.ChatSession(
                title="Older", preset={"worldbook_ids": ["old-book"], "regex_rules": [old_rule]},
            )
            newer = models.ChatSession(
                title="Newer", worldbook_id="new-book", preset={"worldbook_ids": ["deleted-book"], "regex_rules": []},
            )
            db.add_all([older, newer])
            db.commit()
            db.execute(text("UPDATE sessions SET updated_at = '2026-01-01 00:00:00' WHERE id = :id"), {"id": older.id})
            db.execute(text("UPDATE sessions SET updated_at = '2026-02-01 00:00:00' WHERE id = :id"), {"id": newer.id})
            db.commit()
            new_book_id, newer_id = "new-book", newer.id
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


def test_tts_migration_preserves_existing_chat_and_avatars_and_leaves_speech_disabled(tmp_path, monkeypatch):
    database_url = f"sqlite:///{(tmp_path / 'tts-migration.db').as_posix()}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "0009_character_avatar_thumbnails")
    engine = create_engine(database_url)
    try:
        with Session(engine, expire_on_commit=False) as db:
            # These distinct values verify byte-for-byte preservation of every
            # persisted avatar representation, rather than re-rendering them.
            character = models.Character(
                name="Preserved character",
                avatar_data_url="data:image/png;base64,c3RvcmVkLWF2YXRhcg==",
                avatar_original_data_url="data:image/png;base64,c3RvcmVkLW9yaWdpbmFs",
                avatar_thumbnail_data_url="data:image/webp;base64,c3RvcmVkLXRodW1ibmFpbA==",
                avatar_transform={"x": 0.25, "y": 0.75, "scale": 1.5},
            )
            db.add(character)
            db.flush()
            session = models.ChatSession(title="Preserved chat", character_id=character.id)
            db.add(session)
            db.flush()
            message = models.Message(session_id=session.id, role="assistant", content="Original content")
            db.add(message)
            db.commit()
            character_id, session_id, message_id = character.id, session.id, message.id
            avatar_query = text(
                "SELECT avatar_data_url, avatar_original_data_url, avatar_thumbnail_data_url, "
                "avatar_transform, created_at, updated_at FROM characters WHERE id = :id"
            )
            original_avatar = db.execute(avatar_query, {"id": character_id}).one()
        command.upgrade(config, "0010_tts_settings")
        with Session(engine) as db:
            assert db.get(models.ChatSession, session_id).title == "Preserved chat"
            assert db.get(models.ChatSession, session_id).character_id == character_id
            assert db.get(models.Message, message_id).content == "Original content"
            assert db.execute(avatar_query, {"id": character_id}).one() == original_avatar
            assert db.get(models.TtsSettings, "default") is None
            db.add(models.TtsSettings())
            db.commit()
            settings = db.get(models.TtsSettings, "default")
            assert settings.enabled is False
            assert settings.trigger_mode == "manual"
            assert settings.api_key is None
        with engine.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0010_tts_settings"
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        command.downgrade(config, "0009_character_avatar_thumbnails")
        assert "tts_settings" not in inspect(engine).get_table_names()
        with Session(engine) as db:
            assert db.get(models.Message, message_id).content == "Original content"
            assert db.get(models.ChatSession, session_id).character_id == character_id
            assert db.execute(avatar_query, {"id": character_id}).one() == original_avatar
        with engine.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "0009_character_avatar_thumbnails"
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    finally:
        engine.dispose()


def test_worldbook_migration_repairs_only_recognizable_unedited_st_depths(tmp_path, monkeypatch):
    import json

    database_url = f"sqlite:///{(tmp_path / 'worldbook-depth.db').as_posix()}"
    config = alembic_config(database_url, monkeypatch)
    command.upgrade(config, "0010_tts_settings")
    engine = create_engine(database_url)
    cases = [
        ("st-insertion", 4, {"key": ["a"], "depth": 4}, None),
        ("st-explicit-scan", 4, {"key": ["a"], "depth": 4, "scanDepth": 2}, 2),
        ("st-inherit-scan", 4, {"key": ["a"], "depth": 4, "scanDepth": None}, None),
        ("user-edited", 3, {"key": ["a"], "depth": 4}, 3),
        ("native", 4, {"keys": ["a"], "depth": 4, "position": "after_char"}, 4),
        ("already-correct", 2, {"key": ["a"], "depth": 4, "scanDepth": 2}, 2),
        ("invalid-scan", 4, {"key": ["a"], "depth": 4, "scanDepth": -1}, 4),
        ("bool-is-not-depth", 1, {"key": ["a"], "depth": True}, 1),
        ("card-extension", 4, {"keys": ["a"], "extensions": {
            "depth": 4, "scan_depth": 1, "exclude_recursion": True,
            "prevent_recursion": True, "delay_until_recursion": 3,
        }}, 1),
    ]
    try:
        with engine.begin() as connection:
            connection.execute(text("INSERT INTO worldbooks (id, name, description, scan_depth, token_budget, recursive_scanning, raw_json, created_at, updated_at) VALUES ('book', 'Book', '', 8, 4000, 1, :raw, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"),
                               {"raw": json.dumps({"max_recursion_steps": 2})})
            for name, depth, raw, _ in cases:
                connection.execute(text('INSERT INTO worldbook_entries (id, worldbook_id, keys, secondary_keys, content, enabled, constant, selective, "order", position, depth, case_sensitive, match_whole_words, raw_json, created_at, updated_at) VALUES (:id, \'book\', \'["a"]\', \'[]\', \'original\', 1, 0, 0, 100, \'after_char\', :depth, 0, 0, :raw, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'),
                                   {"id": name, "depth": depth, "raw": json.dumps(raw)})
        with Session(engine, expire_on_commit=False) as db:
            session = models.ChatSession(id="chat", title="Preserved")
            db.add(session)
            db.flush()
            root = models.Message(id="root", session_id="chat", role="user", content="root")
            db.add(root)
            db.flush()
            db.add_all([
                models.Message(id="left", session_id="chat", parent_id="root", role="assistant", content="original reply"),
                models.Message(id="right", session_id="chat", parent_id="root", role="assistant",
                               content="partial reply", thinking_content="partial thought", status="interrupted"),
            ])
            db.flush()
            session.active_root_child_id = "root"
            root.selected_child_id = "right"
            db.commit()

        command.upgrade(config, "0011_worldbook_recursion")
        with engine.connect() as connection:
            rows = {row["id"]: row for row in connection.execute(text("SELECT * FROM worldbook_entries")).mappings()}
            for name, _, raw, expected in cases:
                assert rows[name]["depth"] == expected
                assert json.loads(rows[name]["raw_json"]) == raw
                assert rows[name]["content"] == "original"
            assert rows["card-extension"]["exclude_recursion"] == 1
            assert rows["card-extension"]["prevent_recursion"] == 1
            assert rows["card-extension"]["delay_until_recursion"] == 3
            assert rows["native"]["exclude_recursion"] == 0
            assert connection.execute(text("SELECT max_recursion_steps FROM worldbooks")).scalar_one() == 2
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
        with Session(engine) as db:
            assert db.get(models.Message, "root").selected_child_id == "right"
            assert db.get(models.Message, "left").content == "original reply"
            assert db.get(models.Message, "right").content == "partial reply"
            assert db.get(models.Message, "right").thinking_content == "partial thought"
            assert db.get(models.Message, "right").status == "interrupted"
        command.downgrade(config, "0010_tts_settings")
        with engine.connect() as connection:
            assert connection.execute(text("SELECT depth FROM worldbook_entries WHERE id = 'st-insertion'")).scalar_one() is None
            assert connection.execute(text("SELECT content FROM messages WHERE id = 'right'")).scalar_one() == "partial reply"
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    finally:
        engine.dispose()
