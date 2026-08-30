import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import models, schemas
from app.database import Base, get_db
from app.main import create_app
from app.services.prompt_builder import build_context
from app.services.prompt_config import (
    BUILTIN_SLOT_KINDS,
    apply_outgoing_regex,
    default_prompt_slots,
    normalize_prompt_slots,
    normalize_regex_rules,
)
from app.services.providers import _anthropic_messages, _openai_messages, _split_leading_system
from app.services.tree import create_message


def test_required_slots_are_stable_reorderable_editable_and_customizable():
    slots = default_prompt_slots()
    assert [slot["kind"] for slot in slots] == list(BUILTIN_SLOT_KINDS)

    slots[0]["content"] = "Edited main"
    slots[0]["enabled"] = False
    slots.insert(
        1,
        {
            "id": "custom-note",
            "kind": "custom",
            "name": "Custom Note",
            "enabled": True,
            "role": "user",
            "content": "Remember this",
        },
    )
    normalized = normalize_prompt_slots(slots)
    assert normalized[0]["content"] == "Edited main"
    assert normalized[1]["id"] == "custom-note"
    assert normalized[1]["role"] == "user"

    with pytest.raises(ValueError, match="exactly one required 'history'"):
        normalize_prompt_slots([slot for slot in slots if slot["kind"] != "history"])


def test_regex_replace_matches_javascript_global_semantics():
    first_only = schemas.RegexRule(
        id="first", pattern="foo", replacement="bar", flags="", targets=["outgoing_prompt"]
    )
    replace_all = schemas.RegexRule(
        id="all", pattern="foo", replacement="bar", flags="g", targets=["outgoing_prompt"]
    )
    assert apply_outgoing_regex("foo foo", [first_only])[0] == "bar foo"
    assert apply_outgoing_regex("foo foo", [replace_all])[0] == "bar bar"
    capture = schemas.RegexRule(
        id="capture",
        pattern="(foo)",
        replacement="<$1>-$&-$$",
        flags="",
        targets=["outgoing_prompt"],
    )
    assert apply_outgoing_regex("foo", [capture])[0] == "<foo>-foo-$"

    with pytest.raises(ValueError, match="cannot use veil mode"):
        normalize_regex_rules(
            [
                {
                    "id": "bad-veil",
                    "pattern": "foo",
                    "targets": ["outgoing_prompt"],
                    "mode": "veil",
                }
            ]
        )


def test_compiler_respects_history_barrier_multiple_worldbooks_and_post_history():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as db:
        character = models.Character(
            name="Luna",
            description="Moon guide",
            post_history_instructions="Answer softly after history.",
        )
        before_book = models.WorldBook(name="Before", scan_depth=8, token_budget=100)
        before_book.entries = [
            models.WorldBookEntry(content="Before lore", constant=True, position="before_char", order=1)
        ]
        after_book = models.WorldBook(name="After", scan_depth=8, token_budget=100)
        after_book.entries = [
            models.WorldBookEntry(content="After lore", constant=True, position="after_char", order=2)
        ]
        db.add_all([character, before_book, after_book])
        db.flush()
        session = models.ChatSession(
            title="slots",
            character_id=character.id,
            worldbook_id=before_book.id,
            preset={
                "worldbook_ids": [before_book.id, after_book.id],
                "regex_rules": [
                    {
                        "id": "history-rewrite",
                        "name": "History rewrite",
                        "pattern": "secret",
                        "replacement": "visible",
                        "flags": "g",
                        "targets": ["outgoing_prompt"],
                        "mode": "replace",
                        "scope": "session",
                        "enabled": True,
                    }
                ],
            },
        )
        db.add(session)
        db.commit()
        create_message(db, session, parent_id=None, role="user", speaker="User", content="secret secret")

        context = build_context(db, session)
        kinds = [block.slot_kind for block in context.compiled_blocks]
        assert kinds.index("world_before") < kinds.index("history")
        assert kinds.index("history") < kinds.index("world_after") < kinds.index("post_history")
        history = next(block for block in context.compiled_blocks if block.is_history)
        assert history.content == "visible visible"
        assert set(context.worldbook_ids) == {before_book.id, after_book.id}
        assert [item.content for item in context.activated_lore] == ["Before lore", "After lore"]
        assert any(item.code == "regex_applied" and item.match_count == 2 for item in context.diagnostics)

        openai_messages = _openai_messages(context)
        assert openai_messages[-1]["content"] == "Answer softly after history."
        system, _ = _split_leading_system(context)
        assert "Answer softly after history." not in system
        anthropic_messages = _anthropic_messages(context)
        assert anthropic_messages[-1]["role"] == "user"
        assert "Answer softly after history." in anthropic_messages[-1]["content"]


def _api_client() -> TestClient:
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app = create_app(init_on_startup=False)
    app.dependency_overrides[get_db] = override_db
    return TestClient(app)


def test_session_creation_materializes_alternate_greetings_as_root_swipes():
    client = _api_client()
    character = client.post(
        "/api/characters",
        json={
            "name": "Luna",
            "first_mes": "First {{user}} from {{char}}",
            "alternate_greetings": ["Second <USER> from <BOT>", "Third"],
        },
    ).json()
    session = client.post(
        "/api/sessions",
        json={
            "title": "Greetings",
            "character_id": character["id"],
            "preset": {"auto_greeting": True, "user_name": "Ada"},
        },
    ).json()

    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    roots = sorted((item for item in tree["messages"] if item["parent_id"] is None), key=lambda item: item["sort_order"])
    assert [item["content"] for item in roots] == ["First Ada from Luna", "Second Ada from Luna", "Third"]
    assert tree["session"]["active_root_child_id"] == roots[0]["id"]
    assert tree["active_path_ids"] == [roots[0]["id"]]
    assert "prompt_slots" not in session["preset"]


def test_global_prompt_config_is_shared_versioned_and_not_overridden_by_sessions():
    client = _api_client()
    character = client.post("/api/characters", json={"name": "Shared", "first_mes": ""}).json()
    initial = client.get("/api/settings/prompt").json()
    assert initial["revision"] == 0
    slots = initial["prompt_slots"]
    slots[0]["content"] = "Shared global main"

    saved = client.put(
        "/api/settings/prompt",
        json={"prompt_slots": slots, "expected_revision": 0},
    )
    assert saved.status_code == 200
    assert saved.json()["revision"] == 1
    assert client.get("/api/settings/prompt").json()["prompt_slots"][0]["content"] == "Shared global main"

    stale = client.put(
        "/api/settings/prompt",
        json={"prompt_slots": slots, "expected_revision": 0},
    )
    assert stale.status_code == 409
    assert "刷新" in stale.text

    first = client.post(
        "/api/sessions", json={"title": "First", "character_id": character["id"]}
    ).json()
    second = client.post(
        "/api/sessions", json={"title": "Second", "character_id": character["id"]}
    ).json()
    client.post(
        f"/api/sessions/{first['id']}/messages",
        json={"role": "user", "speaker": "User", "content": "first history"},
    )
    client.post(
        f"/api/sessions/{second['id']}/messages",
        json={"role": "user", "speaker": "User", "content": "second history"},
    )
    first_context = client.post(f"/api/sessions/{first['id']}/context/preview").json()
    second_context = client.post(f"/api/sessions/{second['id']}/context/preview").json()
    assert first_context["prompt_config_revision"] == second_context["prompt_config_revision"] == 1
    assert first_context["system"] == second_context["system"] == "Shared global main"
    assert first_context["messages"][0]["content"] == "first history"
    assert second_context["messages"][0]["content"] == "second history"


def test_session_preset_validation_rejects_deleted_slots_bad_regex_and_unknown_worldbooks():
    client = _api_client()
    character = client.post("/api/characters", json={"name": "Validator", "first_mes": ""}).json()
    character_id = character["id"]
    missing_history = [slot for slot in default_prompt_slots() if slot["kind"] != "history"]
    response = client.post(
        "/api/sessions",
        json={"title": "Bad slots", "character_id": character_id, "preset": {"prompt_slots": missing_history}},
    )
    assert response.status_code == 422
    assert "全局配置" in response.text

    response = client.post(
        "/api/sessions",
        json={
            "title": "Bad regex",
            "character_id": character_id,
            "preset": {
                "regex_rules": [
                    {"id": "broken", "pattern": "(", "targets": ["outgoing_prompt"], "mode": "replace"}
                ]
            },
        },
    )
    assert response.status_code == 422
    assert "broken" in response.text

    display_only = client.post(
        "/api/sessions",
        json={
            "title": "Browser regex",
            "character_id": character_id,
            "preset": {
                "regex_rules": [
                    {
                        "id": "js-named-group",
                        "pattern": "(?<name>foo)",
                        "targets": ["display"],
                        "mode": "replace",
                    }
                ]
            },
        },
    )
    assert display_only.status_code == 200

    response = client.post(
        "/api/sessions",
        json={"title": "Bad lore", "character_id": character_id, "preset": {"worldbook_ids": ["does-not-exist"]}},
    )
    assert response.status_code == 422
    assert "does-not-exist" in response.text


def test_worldbook_edits_win_on_export_and_delete_cleans_session_sources():
    client = _api_client()
    character = client.post("/api/characters", json={"name": "Archivist", "first_mes": ""}).json()
    book = client.post(
        "/api/worldbooks",
        json={
            "name": "Editable",
            "entries": [
                {
                    "keys": ["old"],
                    "content": "old content",
                    "order": 10,
                    "raw_json": {"key": ["old"], "content": "stale raw", "order": 10},
                }
            ],
        },
    ).json()
    session = client.post(
        "/api/sessions",
        json={
            "title": "Multiple books",
            "character_id": character["id"],
            "worldbook_id": book["id"],
            "preset": {"worldbook_ids": [book["id"]]},
        },
    ).json()

    updated = client.patch(
        f"/api/worldbooks/{book['id']}",
        json={
            "entries": [
                {
                    "keys": ["new"],
                    "content": "new content",
                    "order": 42,
                    "raw_json": {"key": ["old"], "content": "stale raw", "order": 10},
                }
            ]
        },
    )
    assert updated.status_code == 200
    exported = client.get(f"/api/worldbooks/{book['id']}/export").json()["entries"][0]
    assert exported["key"] == ["new"]
    assert exported["content"] == "new content"
    assert exported["order"] == 42

    assert client.delete(f"/api/worldbooks/{book['id']}").status_code == 200
    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    assert tree["session"]["worldbook_id"] is None
    assert tree["session"]["preset"]["worldbook_ids"] == []


def test_character_list_is_lightweight_and_detail_keeps_original_avatar():
    client = _api_client()
    character = client.post(
        "/api/characters",
        json={
            "name": "Avatar",
            "avatar_data_url": "data:image/png;base64,derived",
            "avatar_original_data_url": "data:image/png;base64,original",
        },
    ).json()
    summary = client.get("/api/characters").json()[0]
    assert summary["id"] == character["id"]
    assert "avatar_original_data_url" not in summary
    detail = client.get(f"/api/characters/{character['id']}").json()
    assert detail["avatar_original_data_url"].endswith("original")
