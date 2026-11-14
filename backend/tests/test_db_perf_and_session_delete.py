from __future__ import annotations

import asyncio
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, inspect, select, text
from sqlalchemy.orm import Session, sessionmaker

from app import models, schemas
from app.accounts import Accounts
from app.api import sessions as session_routes
from app.config import Settings
from app.database import Base, Database, create_database_engine, get_db
from app.main import create_app
from app.services import providers, tree as tree_service
from app.services.errors import ApplicationError


BACKEND_ROOT = Path(__file__).resolve().parents[1]

EXPECTED_0014_INDEXES: dict[str, dict[str, list[str]]] = {
    "messages": {
        "ix_messages_session_id_parent_id_sort_order": ["session_id", "parent_id", "sort_order"],
        "ix_messages_parent_id": ["parent_id"],
        "ix_messages_selected_child_id": ["selected_child_id"],
    },
    "sessions": {
        "ix_sessions_active_root_child_id": ["active_root_child_id"],
        "ix_sessions_archived_pinned_last_activity_at": ["archived", "pinned", "last_activity_at"],
        "ix_sessions_character_id": ["character_id"],
    },
    "worldbook_entries": {
        "ix_worldbook_entries_worldbook_id": ["worldbook_id"],
    },
    "generation_runs": {
        "ix_generation_runs_base_message_id": ["base_message_id"],
    },
}


def _alembic_config(database_url: str, monkeypatch) -> Config:
    monkeypatch.setenv("TREECHAT_DATABASE_URL", database_url)
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    return config


@contextmanager
def _capture_selects(engine):
    statements: list[str] = []

    def record(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", record)


def _index_map(engine, table_name: str) -> dict[str, list[str]]:
    return {
        index["name"]: list(index["column_names"])
        for index in inspect(engine).get_indexes(table_name)
        if index.get("name")
    }


def test_0014_migration_indexes_match_models_and_round_trip(tmp_path, monkeypatch):
    migrated_url = f"sqlite:///{(tmp_path / 'migrated.db').as_posix()}"
    config = _alembic_config(migrated_url, monkeypatch)
    command.upgrade(config, "head")

    migrated_engine = create_engine(migrated_url)
    model_engine = create_engine(f"sqlite:///{(tmp_path / 'models.db').as_posix()}")
    try:
        Base.metadata.create_all(model_engine)

        with migrated_engine.connect() as conn:
            version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
            assert version == "0014_foreign_key_and_query_indexes"

        for table_name, expected in EXPECTED_0014_INDEXES.items():
            migrated_indexes = _index_map(migrated_engine, table_name)
            model_indexes = _index_map(model_engine, table_name)
            for index_name, columns in expected.items():
                assert migrated_indexes.get(index_name) == columns
                assert model_indexes.get(index_name) == columns
            assert migrated_indexes == model_indexes

        # Downgrade to 0013 removes the 0014 indexes while keeping earlier indexes.
        command.downgrade(config, "0013_parallel_generations")
        for table_name, expected in EXPECTED_0014_INDEXES.items():
            downgraded_indexes = _index_map(migrated_engine, table_name)
            for index_name in expected:
                assert index_name not in downgraded_indexes
        assert "ix_generation_runs_session_id" in _index_map(migrated_engine, "generation_runs")

        # Re-upgrading restores every index cleanly; pre-existing indexes are tolerated idempotently.
        with migrated_engine.begin() as conn:
            conn.execute(text("CREATE INDEX ix_messages_parent_id ON messages (parent_id)"))
        command.upgrade(config, "head")
        for table_name, expected in EXPECTED_0014_INDEXES.items():
            restored_indexes = _index_map(migrated_engine, table_name)
            for index_name, columns in expected.items():
                assert restored_indexes.get(index_name) == columns
        with migrated_engine.connect() as conn:
            assert conn.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    finally:
        migrated_engine.dispose()
        model_engine.dispose()


def test_long_path_queries_eliminate_n_plus_one_and_preserve_semantics(tmp_path):
    db_path = tmp_path / "long-tree.db"
    engine = create_database_engine(f"sqlite:///{db_path.as_posix()}")
    Base.metadata.create_all(engine)
    try:
        expected_active_ids: list[str] = []
        expected_side_ids: list[str] = []
        with Session(engine, expire_on_commit=False) as db:
            chat = models.ChatSession(id="chat", title="Long chat")
            other_chat = models.ChatSession(id="other-chat", title="Other chat")
            db.add_all([chat, other_chat])
            db.flush()

            alt_root = models.Message(id="alt-root", session_id="chat", role="assistant", content="Alt root", sort_order=1)
            root = models.Message(id="msg-0", session_id="chat", role="assistant", content="Turn 0", sort_order=2)
            other_root = models.Message(id="other-msg", session_id="other-chat", role="user", content="Other", sort_order=1)
            db.add_all([alt_root, root, other_root])
            db.flush()

            expected_active_ids.append(root.id)
            prev = root
            branch_anchor = root
            for idx in range(1, 60):
                msg = models.Message(
                    id=f"msg-{idx}",
                    session_id="chat",
                    parent_id=prev.id,
                    role="user" if idx % 2 == 1 else "assistant",
                    content=f"Turn {idx}",
                    sort_order=1,
                )
                db.add(msg)
                db.flush()
                prev.selected_child_id = msg.id
                expected_active_ids.append(msg.id)
                if idx == 15:
                    branch_anchor = msg
                    expected_side_ids = list(expected_active_ids)
                prev = msg

            side_prev = branch_anchor
            for idx in range(25):
                side_msg = models.Message(
                    id=f"side-{idx}",
                    session_id="chat",
                    parent_id=side_prev.id,
                    role="assistant" if idx % 2 == 0 else "user",
                    content=f"Side {idx}",
                    sort_order=2,
                )
                db.add(side_msg)
                db.flush()
                if idx > 0:
                    side_prev.selected_child_id = side_msg.id
                expected_side_ids.append(side_msg.id)
                side_prev = side_msg
            side_leaf_id = side_prev.id

            chat.active_root_child_id = root.id
            db.commit()

        # Fresh session: active_path over 60 turns executes a single SELECT on messages.
        with Session(engine) as db:
            chat = db.get(models.ChatSession, "chat")
            with _capture_selects(engine) as selects:
                path = tree_service.active_path(db, chat)
            assert [m.id for m in path] == expected_active_ids
            assert len(selects) == 1

        # Fallback when active_root_child_id is None picks the first root by sort_order in 1 SELECT.
        with Session(engine) as db:
            chat = db.get(models.ChatSession, "chat")
            chat.active_root_child_id = None
            with _capture_selects(engine) as selects:
                fallback_path = tree_service.active_path(db, chat)
            assert [m.id for m in fallback_path] == ["alt-root"]
            assert len(selects) == 1

        # Fresh session: ancestor_path over 41 ancestors executes 1 SELECT on messages.
        with Session(engine) as db:
            leaf = db.get(models.Message, side_leaf_id)
            with _capture_selects(engine) as selects:
                ancestors = tree_service.ancestor_path(db, leaf)
            assert [m.id for m in ancestors] == expected_side_ids
            assert len(selects) == 1

        with Session(engine) as db:
            leaf = db.get(models.Message, side_leaf_id)
            with _capture_selects(engine) as selects:
                ancestors_without_self = tree_service.ancestor_path(db, leaf, include_self=False)
            assert [m.id for m in ancestors_without_self] == expected_side_ids[:-1]
            assert len(selects) == 1

        # Simulate legacy broken links created while foreign_keys=OFF and verify loud 409 errors.
        raw_engine = create_engine(f"sqlite:///{db_path.as_posix()}")
        try:
            with raw_engine.connect() as conn:
                conn.exec_driver_sql("PRAGMA foreign_keys=OFF")
                conn.commit()
                with conn.begin():
                    conn.execute(
                        text(
                            "INSERT INTO messages (id, session_id, parent_id, role, speaker, content, "
                            "thinking_content, status, sort_order, token_count, thinking_token_count, "
                            "cached_tokens, provider_metadata, usage, created_at, updated_at) "
                            "VALUES "
                            "('cycle-a', 'chat', 'cycle-b', 'user', '', 'a', '', 'complete', 9, 0, 0, 0, '{}', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                            "('cycle-b', 'chat', 'cycle-a', 'assistant', '', 'b', '', 'complete', 9, 0, 0, 0, '{}', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), "
                            "('cross-child', 'chat', 'other-msg', 'user', '', 'x', '', 'complete', 9, 0, 0, 0, '{}', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                        )
                    )
        finally:
            raw_engine.dispose()

        with Session(engine) as db:
            cycle_msg = db.get(models.Message, "cycle-a")
            with pytest.raises(ApplicationError, match="Message tree contains a parent cycle") as cycle_exc:
                tree_service.ancestor_path(db, cycle_msg)
            assert cycle_exc.value.status_code == 409

            cross_msg = db.get(models.Message, "cross-child")
            with pytest.raises(ApplicationError, match="Message parent belongs to another session") as cross_exc:
                tree_service.ancestor_path(db, cross_msg)
            assert cross_exc.value.status_code == 409
    finally:
        engine.dispose()


def test_get_active_path_preloads_generation_run_and_defers_prompt_snapshot():
    engine = create_database_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    app = create_app(init_on_startup=False, settings=Settings(_env_file=None, auth_enabled=False))

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    try:
        with factory() as db:
            chat = models.ChatSession(id="session-perf", title="Active path perf")
            db.add(chat)
            db.flush()
            prev = None
            for idx in range(30):
                role = "user" if idx % 2 == 0 else "assistant"
                msg = models.Message(
                    id=f"turn-{idx}",
                    session_id="session-perf",
                    parent_id=prev.id if prev else None,
                    role=role,
                    content=f"Message {idx}",
                    sort_order=1,
                )
                db.add(msg)
                db.flush()
                if prev is None:
                    chat.active_root_child_id = msg.id
                else:
                    prev.selected_child_id = msg.id
                if role == "assistant":
                    db.add(
                        models.GenerationRun(
                            id=f"run-{idx}",
                            session_id="session-perf",
                            base_message_id=prev.id if prev else None,
                            output_message_id=msg.id,
                            provider_type="openai_responses",
                            model="perf-model",
                            status="complete",
                            prompt_snapshot={"large": "x" * 32768},
                            prompt_hash="a" * 64,
                            output_tokens=12,
                        )
                    )
                prev = msg
            db.commit()

        with TestClient(app) as client:
            with _capture_selects(engine) as selects:
                response = client.get("/api/sessions/session-perf/active-path")
            assert response.status_code == 200, response.text
            payload = response.json()
            assert len(payload) == 30
            assistant_items = [item for item in payload if item["role"] == "assistant"]
            assert len(assistant_items) == 15
            assert all(item["generation_run"]["model"] == "perf-model" for item in assistant_items)
            # Only 3 SELECTs total: sessions, messages, generation_runs (no N+1, no prompt_snapshot).
            assert len(selects) == 3
            assert all("prompt_snapshot" not in stmt for stmt in selects)
    finally:
        engine.dispose()


def test_tree_write_entrypoints_serialize_session_writes(monkeypatch):
    engine = create_database_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    app = create_app(init_on_startup=False, settings=Settings(_env_file=None, auth_enabled=False))

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    lock_calls: list[str] = []
    real_serialize = tree_service.serialize_session_writes

    def tracking_serialize(db: Session, session: models.ChatSession) -> None:
        lock_calls.append(session.id)
        real_serialize(db, session)

    monkeypatch.setattr(tree_service, "serialize_session_writes", tracking_serialize)
    monkeypatch.setattr(session_routes, "serialize_session_writes", tracking_serialize)

    try:
        with TestClient(app) as client:
            char = client.post("/api/characters", json={"name": "LockTester", "first_mes": ""}).json()
            chat = client.post(
                "/api/sessions",
                json={"character_id": char["id"], "preset": {"auto_greeting": False}},
            ).json()
            sid = chat["id"]

            lock_calls.clear()
            first = client.post(f"/api/sessions/{sid}/messages", json={"role": "user", "content": "one"}).json()
            assert lock_calls == [sid]

            lock_calls.clear()
            swiped = client.post(f"/api/messages/{first['id']}/swipes", json={"content": "one-alt"}).json()
            assert lock_calls == [sid]
            assert swiped["active_path_ids"] != [first["id"]]

            lock_calls.clear()
            selected = client.post(f"/api/messages/{first['id']}/select").json()
            assert lock_calls == [sid]
            assert selected["active_path_ids"] == [first["id"]]

            # Verify append_message reloads session selection committed right before the write lock.
            def concurrent_append_before_lock(db: Session, cached_session: models.ChatSession) -> None:
                with factory() as other_db:
                    stored = other_db.get(models.ChatSession, sid)
                    tree_service.create_message(
                        other_db,
                        stored,
                        parent_id=first["id"],
                        role="assistant",
                        content="committed concurrently",
                    )
                real_serialize(db, cached_session)

            monkeypatch.setattr(session_routes, "serialize_session_writes", concurrent_append_before_lock)
            appended = client.post(f"/api/sessions/{sid}/messages", json={"role": "user", "content": "after lock"}).json()
            tree_state = client.get(f"/api/sessions/{sid}/tree").json()
            concurrent_msg = next(m for m in tree_state["messages"] if m["content"] == "committed concurrently")
            assert appended["parent_id"] == concurrent_msg["id"]
    finally:
        engine.dispose()


def test_delete_session_stops_live_generations_and_cleans_self_referencing_branches(tmp_path, monkeypatch):
    database = Database(f"sqlite:///{(tmp_path / 'delete-session.db').as_posix()}")
    app = create_app(settings=Settings(_env_file=None, auth_enabled=False), database=database)
    stream_closed_prompts: list[str] = []
    other_gate = asyncio.Event()

    async def controllable_stream(profile, context):
        prompt_tail = context.messages[-1].content if context.messages else ""
        try:
            yield providers.ProviderStreamEvent(kind="thinking", delta="thinking...")
            yield providers.ProviderStreamEvent(kind="text", delta=f"partial:{prompt_tail}")
            if prompt_tail == "other-session-prompt":
                while not other_gate.is_set():
                    await asyncio.sleep(0.01)
                yield providers.ProviderStreamEvent(kind="text", delta=":done")
            else:
                await asyncio.Event().wait()
        finally:
            stream_closed_prompts.append(prompt_tail)

    monkeypatch.setattr(providers, "stream_completion", controllable_stream)

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            with TestClient(app) as client:
                char = client.post(
                    "/api/characters",
                    json={"name": "Apeiria", "first_mes": "Greeting 1", "alternate_greetings": ["Greeting 2"]},
                ).json()
                profile = client.post(
                    "/api/api-profiles",
                    json={
                        "name": "Test Profile",
                        "provider_type": "openai_responses",
                        "base_url": "https://example.test",
                        "model": "mock-model",
                        "api_key": "test-secret",
                    },
                ).json()
                target = client.post(
                    "/api/sessions",
                    json={"title": "Target", "character_id": char["id"], "api_profile_id": profile["id"]},
                ).json()
                other = client.post(
                    "/api/sessions",
                    json={"title": "Other", "character_id": char["id"], "api_profile_id": profile["id"]},
                ).json()

                # Build multi-branch history with self-referencing parent_id & selected_child_id pointers.
                branch_a = client.post(
                    f"/api/sessions/{target['id']}/messages",
                    json={"role": "user", "content": "branch-a"},
                ).json()
                swipe_tree = client.post(
                    f"/api/messages/{branch_a['id']}/swipes",
                    json={"role": "user", "content": "branch-b"},
                ).json()
                branch_b = next(m for m in swipe_tree["messages"] if m["content"] == "branch-b")
                other_user = client.post(
                    f"/api/sessions/{other['id']}/messages",
                    json={"role": "user", "content": "other-session-prompt"},
                ).json()
                assert other_user["id"]

                # Start two parallel live generations in target session + one in other session.
                fut_a = pool.submit(
                    lambda: client.post(
                        f"/api/sessions/{target['id']}/generate/stream",
                        json={"parent_message_id": branch_a["id"]},
                    ).text
                )
                fut_b = pool.submit(
                    lambda: client.post(
                        f"/api/sessions/{target['id']}/generate/stream",
                        json={"parent_message_id": branch_b["id"]},
                    ).text
                )
                fut_other = pool.submit(
                    lambda: client.post(
                        f"/api/sessions/{other['id']}/generate/stream",
                        json={},
                    ).text
                )

                deadline = time.monotonic() + 10
                while True:
                    active = client.get("/api/generation-runs/active").json()
                    target_active = [item for item in active if item["session_id"] == target["id"]]
                    other_active = [item for item in active if item["session_id"] == other["id"]]
                    if len(target_active) == 2 and len(other_active) == 1:
                        lives = [
                            app.state.generations.get(database.engine, item["run_id"])
                            for item in target_active
                        ]
                        if all(live is not None and live.message["content"].startswith("partial:") for live in lives):
                            break
                    assert time.monotonic() < deadline, f"Timed out waiting for live runs: {active}"
                    time.sleep(0.02)

                delete_resp = client.delete(f"/api/sessions/{target['id']}")
                assert delete_resp.status_code == 200, delete_resp.text
                assert delete_resp.json() == {"ok": True}

                # Both target streams terminated promptly and ran their generator cleanup.
                assert "message_stopped" in fut_a.result(timeout=10)
                assert "message_stopped" in fut_b.result(timeout=10)
                assert {"branch-a", "branch-b"}.issubset(set(stream_closed_prompts))
                assert [
                    item for item in client.get("/api/generation-runs/active").json()
                    if item["session_id"] == target["id"]
                ] == []
                assert client.get(f"/api/sessions/{target['id']}/tree").status_code == 404

                # Other session's live stream was untouched and finishes cleanly.
                other_gate.set()
                assert "message_completed" in fut_other.result(timeout=10)
                assert client.get(f"/api/sessions/{other['id']}/tree").status_code == 200

        with database.open_session() as db:
            assert db.get(models.ChatSession, target["id"]) is None
            assert db.scalars(select(models.Message).where(models.Message.session_id == target["id"])).all() == []
            assert db.scalars(select(models.GenerationRun).where(models.GenerationRun.session_id == target["id"])).all() == []
            assert db.get(models.ChatSession, other["id"]) is not None
            assert db.execute(text("PRAGMA foreign_key_check")).all() == []
    finally:
        database.dispose()


def test_worldbook_list_preloads_entries_and_delete_preserves_session_last_activity_at():
    engine = create_database_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    app = create_app(init_on_startup=False, settings=Settings(_env_file=None, auth_enabled=False))

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            created_books = []
            for idx in range(5):
                wb = client.post(
                    "/api/worldbooks",
                    json={
                        "name": f"Book {idx}",
                        "entries": [
                            {"keys": [f"late-{idx}"], "content": "later", "order": 20},
                            {"keys": [f"early-{idx}"], "content": "earlier", "order": 5},
                        ],
                    },
                ).json()
                created_books.append(wb)

            with _capture_selects(engine) as selects:
                listed = client.get("/api/worldbooks")
            assert listed.status_code == 200, listed.text
            books_json = listed.json()
            assert len(books_json) == 5
            assert all([e["order"] for e in book["entries"]] == [5, 20] for book in books_json)
            wb_selects = [
                stmt for stmt in selects
                if "FROM worldbooks" in stmt or "FROM worldbook_entries" in stmt
            ]
            assert len(wb_selects) == 2

            char = client.post("/api/characters", json={"name": "Historian", "first_mes": ""}).json()
            wb_to_delete = created_books[0]["id"]
            wb_to_keep = created_books[1]["id"]
            old_session = client.post(
                "/api/sessions",
                json={
                    "title": "Ancient session",
                    "character_id": char["id"],
                    "worldbook_id": wb_to_delete,
                    "preset": {"auto_greeting": False, "worldbook_ids": [wb_to_delete, wb_to_keep]},
                },
            ).json()
            recent_session = client.post(
                "/api/sessions",
                json={
                    "title": "Recent session",
                    "character_id": char["id"],
                    "preset": {"auto_greeting": False},
                },
            ).json()

            ancient_time = datetime(2023, 5, 1, 12, 0, 0, tzinfo=timezone.utc)
            recent_time = datetime(2025, 8, 15, 12, 0, 0, tzinfo=timezone.utc)
            with factory() as db:
                db.get(models.ChatSession, old_session["id"]).last_activity_at = ancient_time
                db.get(models.ChatSession, recent_session["id"]).last_activity_at = recent_time
                db.commit()

            before_old = next(
                item for item in client.get("/api/sessions").json() if item["id"] == old_session["id"]
            )

            del_resp = client.delete(f"/api/worldbooks/{wb_to_delete}")
            assert del_resp.status_code == 200, del_resp.text

            sessions_after = client.get("/api/sessions").json()
            assert [item["id"] for item in sessions_after] == [recent_session["id"], old_session["id"]]
            after_old = sessions_after[1]
            assert after_old["worldbook_id"] is None
            assert after_old["preset"]["worldbook_ids"] == [wb_to_keep]
            assert after_old["last_activity_at"] == before_old["last_activity_at"]
    finally:
        engine.dispose()


def test_accounts_enabled_caches_positive_check_without_cross_instance_pollution(tmp_path):
    settings_a = Settings(_env_file=None, database_url=f"sqlite:///{(tmp_path / 'a.db').as_posix()}", auth_enabled=False)
    settings_b = Settings(_env_file=None, database_url=f"sqlite:///{(tmp_path / 'b.db').as_posix()}", auth_enabled=False)
    db_a = Database(settings_a.database_url)
    db_b = Database(settings_b.database_url)
    accounts_a = Accounts(settings_a, db_a)
    accounts_b = Accounts(settings_b, db_b)
    reopened_a: Accounts | None = None

    try:
        assert accounts_a.enabled is False
        assert accounts_b.enabled is False

        accounts_a.setup("owner", "sufficiently-long-password", "Owner")
        assert accounts_a._has_users_cached is True
        assert accounts_b._has_users_cached is False

        with _capture_selects(accounts_a._engine) as selects:
            for _ in range(10):
                assert accounts_a.enabled is True
        assert selects == []
        assert accounts_b.enabled is False

        # Reopening against an existing accounts.db queries users once on initialize(), then serves from cache.
        reopened_a = Accounts(settings_a, db_a)
        reopened_a.initialize()
        assert reopened_a._has_users_cached is True
        with _capture_selects(reopened_a._engine) as reopened_selects:
            for _ in range(10):
                assert reopened_a.enabled is True
        assert reopened_selects == []

        accounts_a.dispose()
        assert accounts_a._has_users_cached is False
    finally:
        if reopened_a is not None:
            reopened_a.dispose()
        accounts_a.dispose()
        accounts_b.dispose()
        db_a.dispose()
        db_b.dispose()
