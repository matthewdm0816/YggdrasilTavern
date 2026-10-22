from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import sessionmaker

from app import models, schemas
from app.api import sessions as session_routes
from app.config import Settings
from app.database import Base, create_database_engine, get_db
from app.main import create_app
from app.services import generation as generation_service, tree as tree_service


@pytest.fixture
def client():
    # Exercise the same foreign-key enforcement as the real application.
    engine = create_database_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    app = create_app(init_on_startup=False, settings=Settings(_env_file=None, auth_enabled=False))
    app.state.tree_action_factory = factory

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    with TestClient(app) as api:
        yield api
    engine.dispose()


def session(client):
    character = client.post("/api/characters", json={"name": "Apeiria", "first_mes": ""}).json()
    response = client.post("/api/sessions", json={
        "character_id": character["id"], "preset": {"auto_greeting": False, "user_name": "Owner"},
    })
    assert response.status_code == 200, response.text
    return response.json()["id"]


def message(client, session_id, content="", parent=None, thinking="", status="complete"):
    with client.app.state.tree_action_factory() as db:
        stored = tree_service.create_message(
            db, db.get(models.ChatSession, session_id), parent_id=parent,
            role="assistant", speaker="Apeiria", content=content,
            thinking_content=thinking, status=status,
        )
        return stored.id


def tree(client, session_id):
    response = client.get(f"/api/sessions/{session_id}/tree")
    assert response.status_code == 200, response.text
    return response.json()


def ids(result):
    return {item["id"] for item in result["messages"]}


def assert_valid_pointers(client, session_id):
    state = tree(client, session_id)
    by_id = {item["id"]: item for item in state["messages"]}
    root = state["session"]["active_root_child_id"]
    assert root is None or (root in by_id and by_id[root]["parent_id"] is None)
    for item in by_id.values():
        selected = item["selected_child_id"]
        assert selected is None or (selected in by_id and by_id[selected]["parent_id"] == item["id"])
    with client.app.state.tree_action_factory() as db:
        assert db.execute(text("PRAGMA foreign_key_check")).all() == []


def test_delete_selected_swipe_removes_only_its_descendants_and_selects_previous(client):
    sid = session(client)
    root = message(client, sid, "root")
    first = message(client, sid, "first", root)
    first_tail = message(client, sid, "first tail", first)
    selected = message(client, sid, "selected", root)
    selected_tail = message(client, sid, "selected tail", selected)
    next_swipe = message(client, sid, "next", root)
    client.post(f"/api/messages/{selected}/select")
    other_sid = session(client)
    other = message(client, other_sid, "other session")

    response = client.delete(f"/api/messages/{selected}")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["deleted_count"] == 2
    assert ids(result) == {root, first, first_tail, next_swipe}
    assert selected_tail not in ids(result)
    assert result["active_path_ids"] == [root, first, first_tail]
    assert ids(tree(client, other_sid)) == {other}
    assert_valid_pointers(client, sid)


def test_delete_first_root_swipe_selects_next_root_and_retains_its_path(client):
    sid = session(client)
    first = message(client, sid, "first root")
    message(client, sid, "first tail", first)
    second = message(client, sid, "second root")
    second_tail = message(client, sid, "second tail", second)
    client.post(f"/api/messages/{first}/select")
    response = client.delete(f"/api/messages/{first}")
    assert response.status_code == 200, response.text
    assert response.json()["active_path_ids"] == [second, second_tail]
    assert response.json()["session"]["active_root_child_id"] == second
    assert_valid_pointers(client, sid)


def test_delete_inactive_swipe_preserves_current_selection(client):
    sid = session(client)
    root = message(client, sid, "root")
    inactive = message(client, sid, "inactive", root)
    active = message(client, sid, "active", root)
    response = client.delete(f"/api/messages/{inactive}")
    assert response.status_code == 200, response.text
    assert response.json()["active_path_ids"] == [root, active]
    assert_valid_pointers(client, sid)


def test_delete_layer_only_deletes_siblings_with_the_same_parent(client):
    sid = session(client)
    root = message(client, sid, "root")
    left = message(client, sid, "left", root)
    left_child = message(client, sid, "left child", left)
    left_alternative = message(client, sid, "left alternative", left)
    message(client, sid, "left grandchild", left_alternative)
    right = message(client, sid, "right", root)
    right_child = message(client, sid, "right child", right)
    client.post(f"/api/messages/{left_alternative}/select")

    response = client.delete(f"/api/messages/{left_child}?scope=layer")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["deleted_count"] == 3
    assert ids(result) == {root, left, right, right_child}
    assert result["active_path_ids"] == [root, left]
    assert_valid_pointers(client, sid)


def test_delete_root_layer_clears_session_and_all_root_swipes(client):
    sid = session(client)
    first = message(client, sid, "first")
    message(client, sid, "first child", first)
    second = message(client, sid, "second")
    message(client, sid, "second child", second)
    response = client.delete(f"/api/messages/{first}?scope=layer")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["deleted_count"] == 4
    assert result["messages"] == []
    assert result["active_path_ids"] == []
    assert result["session"]["active_root_child_id"] is None
    assert_valid_pointers(client, sid)


def test_prune_keeps_blank_ancestors_of_content_or_thinking_and_removes_blank_descendants(client):
    sid = session(client)
    root = message(client, sid, " \t\n")
    content_parent = message(client, sid, "", root)
    content = message(client, sid, "kept", content_parent)
    message(client, sid, "\u3000", content)
    thinking_parent = message(client, sid, "", root)
    thinking = message(client, sid, "", thinking_parent, thinking="reasoning")
    blank = message(client, sid, "\n ", root, thinking="\t")
    message(client, sid, "", blank, status="failed")
    blank_root = message(client, sid, "")
    message(client, sid, "", blank_root)
    client.post(f"/api/messages/{thinking}/select")
    before_path = tree(client, sid)["active_path_ids"]

    response = client.post(f"/api/sessions/{sid}/prune-empty-branches")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["deleted_count"] == 5
    assert ids(result) == {root, content_parent, content, thinking_parent, thinking}
    assert result["active_path_ids"] == before_path
    again = client.post(f"/api/sessions/{sid}/prune-empty-branches")
    assert again.status_code == 200
    assert again.json()["deleted_count"] == 0
    assert_valid_pointers(client, sid)


def test_prune_selected_empty_swipe_restores_nonempty_sibling(client):
    sid = session(client)
    root = message(client, sid, "root")
    kept = message(client, sid, "keep", root)
    blank = message(client, sid, "", root)
    message(client, sid, "", blank)
    response = client.post(f"/api/sessions/{sid}/prune-empty-branches")
    assert response.status_code == 200, response.text
    assert response.json()["active_path_ids"] == [root, kept]
    assert_valid_pointers(client, sid)


def test_prune_all_blank_roots_clears_active_root(client):
    sid = session(client)
    root = message(client, sid, "")
    message(client, sid, "", root)
    message(client, sid, "\t")
    response = client.post(f"/api/sessions/{sid}/prune-empty-branches")
    assert response.status_code == 200, response.text
    assert response.json()["deleted_count"] == 3
    assert response.json()["session"]["active_root_child_id"] is None
    assert response.json()["messages"] == []
    assert_valid_pointers(client, sid)


@pytest.mark.parametrize("role,speaker", [("user", "Owner"), ("assistant", "Apeiria"), ("system", "System")])
def test_change_role_updates_speaker_and_preserves_message_identity_and_descendants(client, role, speaker):
    sid = session(client)
    root = message(client, sid, "original", thinking="original thought")
    child = message(client, sid, "child", root)
    before = tree(client, sid)
    response = client.patch(f"/api/messages/{root}", json={"role": role})
    assert response.status_code == 200, response.text
    assert response.json()["role"] == role
    assert response.json()["speaker"] == speaker
    assert response.json()["id"] == root
    assert response.json()["content"] == "original"
    assert response.json()["thinking_content"] == "original thought"
    after = tree(client, sid)
    assert ids(after) == {root, child}
    assert after["active_path_ids"] == before["active_path_ids"]
    assert_valid_pointers(client, sid)


def test_change_role_accepts_explicit_speaker_and_rejects_invalid_role(client):
    sid = session(client)
    root = message(client, sid, "original")
    response = client.patch(f"/api/messages/{root}", json={"role": "user", "speaker": "Custom"})
    assert response.status_code == 200, response.text
    assert response.json()["speaker"] == "Custom"
    for role in ["tool", None]:
        response = client.patch(f"/api/messages/{root}", json={"role": role})
        assert response.status_code == 422, response.text


@pytest.mark.parametrize("running_source", ["message", "generation"])
def test_tree_actions_reject_any_generation_in_session_without_partial_changes(client, running_source):
    sid = session(client)
    root = message(client, sid, "root")
    blank = message(client, sid, "", root)
    if running_source == "message":
        message(client, sid, "", root, status="streaming")
    else:
        with client.app.state.tree_action_factory() as db:
            db.add(models.GenerationRun(
                session_id=sid, base_message_id=root, provider_type="openai_chat_completions",
                model="test", prompt_hash="test", status="streaming",
            ))
            db.commit()
    before = tree(client, sid)
    responses = [
        client.delete(f"/api/messages/{blank}"),
        client.delete(f"/api/messages/{blank}?scope=layer"),
        client.post(f"/api/sessions/{sid}/prune-empty-branches"),
        client.patch(f"/api/messages/{root}", json={"role": "user"}),
    ]
    assert all(response.status_code == 409 for response in responses), [response.text for response in responses]
    assert tree(client, sid) == before


def test_deletion_keeps_generation_history_with_cleared_deleted_message_references(client):
    sid = session(client)
    root = message(client, sid, "root")
    output = message(client, sid, "answer", root)
    with client.app.state.tree_action_factory() as db:
        run = models.GenerationRun(
            session_id=sid, base_message_id=root, output_message_id=output,
            provider_type="openai_chat_completions", model="test", prompt_hash="test", status="complete",
        )
        db.add(run)
        db.commit()
        run_id = run.id
    response = client.delete(f"/api/messages/{root}")
    assert response.status_code == 200, response.text
    run = client.get(f"/api/generation-runs/{run_id}").json()
    assert run["status"] == "complete"
    assert run["base_message_id"] is None
    assert run["output_message_id"] is None
    assert_valid_pointers(client, sid)


def test_deletion_rolls_back_messages_and_selection_when_a_later_step_fails(client, monkeypatch):
    sid = session(client)
    root = message(client, sid, "root")
    first = message(client, sid, "first", root)
    second = message(client, sid, "second", root)
    before = tree(client, sid)
    original = tree_service._delete_tree_messages

    def fail_after_delete(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("forced transaction failure")

    monkeypatch.setattr(tree_service, "_delete_tree_messages", fail_after_delete)
    with pytest.raises(RuntimeError, match="forced transaction failure"):
        client.delete(f"/api/messages/{second}")
    assert tree(client, sid) == before
    assert ids(tree(client, sid)) == {root, first, second}
    assert_valid_pointers(client, sid)


def test_deletion_handles_more_than_one_batch_with_foreign_keys_enabled(client):
    sid = session(client)
    with client.app.state.tree_action_factory() as db:
        stored_session = db.get(models.ChatSession, sid)
        root = tree_service.create_message(db, stored_session, parent_id=None, role="assistant", content="root", commit=False)
        root_id = root.id
        parent = root
        # A chain longer than one SQL batch also verifies nonrecursive traversal.
        for index in range(505):
            child = models.Message(session_id=sid, parent_id=parent.id, role="assistant", content="", sort_order=index)
            db.add(child)
            db.flush()
            parent.selected_child_id = child.id
            parent = child
        db.commit()
    response = client.delete(f"/api/messages/{root_id}")
    assert response.status_code == 200, response.text
    assert response.json()["deleted_count"] == 506
    assert response.json()["messages"] == []
    assert_valid_pointers(client, sid)


def test_generation_reloads_selection_if_deletion_finishes_after_initial_session_read(client, monkeypatch):
    sid = session(client)
    kept = message(client, sid, "kept branch")
    removed = message(client, sid, "deleted branch")
    profile = client.post("/api/api-profiles", json={
        "name": "Test", "provider_type": "openai_chat_completions", "model": "test",
        "base_url": "https://provider.test/v1", "api_key": "test-key",
    }).json()
    assert client.patch(f"/api/sessions/{sid}", json={"api_profile_id": profile["id"]}).status_code == 200
    original_prepare = generation_service.prepare_tree_mutation

    def finish_deletion_before_lock(db, cached_session, **kwargs):
        assert cached_session.active_root_child_id == removed
        with client.app.state.tree_action_factory() as other_db:
            tree_service.delete_message_branch(other_db, removed)
        return original_prepare(db, cached_session, **kwargs)

    monkeypatch.setattr(generation_service, "prepare_tree_mutation", finish_deletion_before_lock)
    with client.app.state.tree_action_factory() as db:
        handle = asyncio.run(generation_service.start_generation(sid, schemas.GenerateRequest(), db))
        try:
            run = db.get(models.GenerationRun, handle.run_id)
            assert run.base_message_id == kept
            contents = [item["content"] for item in run.prompt_snapshot["messages"]]
            assert "kept branch" in contents
            assert "deleted branch" not in contents
        finally:
            asyncio.run(handle.aclose())
    assert_valid_pointers(client, sid)


def test_change_role_returns_not_found_if_message_is_deleted_before_lock(client, monkeypatch):
    sid = session(client)
    kept = message(client, sid, "keep")
    removed = message(client, sid, "remove")
    original_prepare = session_routes.prepare_tree_mutation

    def finish_deletion_before_lock(db, cached_session):
        with client.app.state.tree_action_factory() as other_db:
            tree_service.delete_message_branch(other_db, removed)
        return original_prepare(db, cached_session)

    monkeypatch.setattr(session_routes, "prepare_tree_mutation", finish_deletion_before_lock)
    response = client.patch(f"/api/messages/{removed}", json={"role": "user"})
    assert response.status_code == 404, response.text
    result = tree(client, sid)
    assert ids(result) == {kept}
    assert result["active_path_ids"] == [kept]
    assert result["messages"][0]["role"] == "assistant"
