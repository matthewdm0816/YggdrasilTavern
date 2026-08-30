from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base, get_db
from app.main import create_app
from app.services import providers
from app.services.token_counter import count_text_tokens


def make_client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    testing_session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_db():
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app = create_app(init_on_startup=False)
    app.dependency_overrides[get_db] = override_db
    return TestClient(app), testing_session


def create_profile_and_session(client: TestClient, *, character_id: str | None = None):
    if character_id is None:
        character_id = client.post(
            "/api/characters", json={"name": "Test Character", "first_mes": ""}
        ).json()["id"]
    profile = client.post(
        "/api/api-profiles",
        json={
            "name": "Recorded profile",
            "provider_type": "openai_responses",
            "base_url": "https://example.test",
            "model": "mock-model",
            "api_key_env": "OPENAI_API_KEY",
            "default_params": {"temperature": 0.7},
        },
    ).json()
    session = client.post(
        "/api/sessions",
        json={"title": "Session", "character_id": character_id, "api_profile_id": profile["id"]},
    ).json()
    return profile, session


def test_failed_stream_preserves_all_partial_data_and_generation_metadata(monkeypatch):
    client, testing_session = make_client()

    async def failing_stream(profile, context):
        assert context.messages[-1].content == "Hello"
        yield providers.ProviderStreamEvent(kind="thinking", delta="considering")
        yield providers.ProviderStreamEvent(kind="text", delta="Partial answer")
        yield providers.ProviderStreamEvent(
            kind="usage",
            usage={"input_tokens": 10, "output_tokens": 3, "input_tokens_details": {"cached_tokens": 2}},
        )
        await asyncio.sleep(0.01)
        raise RuntimeError("provider disconnected")

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(providers, "stream_completion", failing_stream)
    _profile, session = create_profile_and_session(client)
    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "speaker": "User", "content": "Hello"},
    )

    with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
        body = "".join(response.iter_text())
    assert "provider disconnected" in body

    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    failed = tree["messages"][-1]
    assert failed["status"] == "failed"
    assert failed["content"] == "Partial answer"
    assert failed["thinking_content"] == "considering"
    assert failed["usage"]["input_tokens"] == 10
    assert failed["cached_tokens"] == 2
    assert failed["generation_run"]["status"] == "failed"
    assert failed["generation_run"]["input_tokens"] == 10
    assert failed["generation_run"]["output_tokens"] == 3
    assert failed["generation_run"]["cached_input_tokens"] == 2
    assert failed["generation_run"]["tokens_per_second"] > 0
    run_detail = client.get(f"/api/generation-runs/{failed['generation_run']['id']}").json()
    assert run_detail["parameters"] == {"temperature": 0.7}
    assert run_detail["prompt_snapshot"]["messages"][-1]["content"] == "Hello"

    # Interrupted/failed assistant content remains part of future roleplay context.
    preview = client.post(f"/api/sessions/{session['id']}/context/preview").json()
    assert preview["messages"][-1]["content"] == "Partial answer"

    with testing_session() as db:
        run = db.scalars(select(models.GenerationRun)).one()
        assert run.output_message_id == failed["id"]
        assert len(run.prompt_hash) == 64


def test_cancelled_stream_persists_partial_content_and_cancelled_status(monkeypatch):
    client, testing_session = make_client()

    async def cancelled_stream(profile, context):
        # Anthropic-style streams can report a tiny initial usage value before
        # any deltas. Cancellation means a final cumulative usage never arrives.
        yield providers.ProviderStreamEvent(
            kind="usage",
            usage={
                "input_tokens": 42,
                "output_tokens": 1,
                "output_tokens_details": {"reasoning_tokens": 1},
            },
        )
        yield providers.ProviderStreamEvent(kind="text", delta="Keep this partial")
        yield providers.ProviderStreamEvent(kind="thinking", delta="Keep this thought")
        raise asyncio.CancelledError()

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(providers, "stream_completion", cancelled_stream)
    _profile, session = create_profile_and_session(client)
    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "content": "Start"},
    )

    try:
        with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
            "".join(response.iter_text())
    except BaseException:
        # The endpoint intentionally re-raises cancellation after durable save.
        pass

    with testing_session() as db:
        run = db.scalars(select(models.GenerationRun)).one()
        message = db.get(models.Message, run.output_message_id)
        assert run.status == "cancelled"
        assert run.completed_at is not None
        assert message is not None
        assert message.status == "cancelled"
        assert message.content == "Keep this partial"
        assert message.thinking_content == "Keep this thought"
        expected_text_tokens = count_text_tokens(message.content, "mock-model")
        expected_thinking_tokens = count_text_tokens(message.thinking_content, "mock-model")
        assert message.token_count == expected_text_tokens
        assert message.thinking_token_count == expected_thinking_tokens
        assert run.input_tokens == 42
        assert run.output_tokens == expected_text_tokens + expected_thinking_tokens
        assert run.output_tokens > 1
        assert run.usage_source == "mixed"
        assert message.provider_metadata["usage_reconciled"] is True


def test_completed_stream_keeps_final_cumulative_provider_usage(monkeypatch):
    client, testing_session = make_client()

    async def completed_stream(profile, context):
        yield providers.ProviderStreamEvent(kind="usage", usage={"input_tokens": 30, "output_tokens": 1})
        yield providers.ProviderStreamEvent(kind="text", delta="A complete provider response")
        yield providers.ProviderStreamEvent(kind="usage", usage={"output_tokens": 7})

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(providers, "stream_completion", completed_stream)
    _profile, session = create_profile_and_session(client)
    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "content": "Start"},
    )

    with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
        body = "".join(response.iter_text())
    assert "message_completed" in body

    with testing_session() as db:
        run = db.scalars(select(models.GenerationRun)).one()
        message = db.get(models.Message, run.output_message_id)
        assert run.status == "complete"
        assert run.input_tokens == 30
        assert run.output_tokens == 7
        assert run.usage_source == "provider"
        assert message is not None
        assert message.provider_metadata["usage_reconciled"] is False


def test_completed_stream_reconciles_usage_that_precedes_later_content(monkeypatch):
    client, testing_session = make_client()

    async def completed_without_final_usage(profile, context):
        yield providers.ProviderStreamEvent(kind="usage", usage={"input_tokens": 30, "output_tokens": 1})
        yield providers.ProviderStreamEvent(kind="text", delta="Content received after provisional usage")

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(providers, "stream_completion", completed_without_final_usage)
    _profile, session = create_profile_and_session(client)
    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "content": "Start"},
    )

    with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
        body = "".join(response.iter_text())
    assert "message_completed" in body

    with testing_session() as db:
        run = db.scalars(select(models.GenerationRun)).one()
        message = db.get(models.Message, run.output_message_id)
        assert message is not None
        expected = count_text_tokens(message.content, "mock-model")
        assert run.status == "complete"
        assert run.output_tokens == expected
        assert run.output_tokens > 1
        assert run.usage_source == "mixed"
        assert message.provider_metadata["usage_reconciled"] is True


def test_regenerate_inactive_assistant_uses_its_own_ancestor_path(monkeypatch):
    client, _testing_session = make_client()
    seen_contexts: list[list[str]] = []

    async def recording_stream(profile, context):
        seen_contexts.append([message.content for message in context.messages])
        yield providers.ProviderStreamEvent(kind="text", delta="regenerated")

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(providers, "stream_completion", recording_stream)
    _profile, session = create_profile_and_session(client)
    user = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "content": "root prompt"},
    ).json()
    original = client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "assistant", "content": "original answer"},
    ).json()
    alternate_tree = client.post(
        f"/api/messages/{original['id']}/swipes",
        json={"content": "alternate answer"},
    ).json()
    alternate = next(message for message in alternate_tree["messages"] if message["content"] == "alternate answer")
    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "content": "only on alternate branch"},
    )

    with client.stream(
        "POST",
        f"/api/sessions/{session['id']}/generate/stream",
        json={"regenerate_message_id": original["id"]},
    ) as response:
        body = "".join(response.iter_text())
    assert "message_completed" in body
    assert seen_contexts == [["root prompt"]]

    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    regenerated = next(message for message in tree["messages"] if message["content"] == "regenerated")
    assert regenerated["parent_id"] == user["id"]
    run_detail = client.get(f"/api/generation-runs/{regenerated['generation_run']['id']}").json()
    assert run_detail["base_message_id"] == user["id"]
    assert tree["active_path_ids"] == [user["id"], regenerated["id"]]
    assert alternate["id"] not in tree["active_path_ids"]

    invalid = client.post(
        f"/api/sessions/{session['id']}/generate/stream",
        json={"regenerate_message_id": user["id"]},
    )
    assert invalid.status_code == 400
    assert invalid.json()["detail"] == "Only assistant messages can be regenerated"


def test_first_message_and_alternate_greetings_are_root_swipes():
    client, _testing_session = make_client()
    character = client.post(
        "/api/characters",
        json={
            "name": "Luna",
            "first_mes": "First greeting",
            "alternate_greetings": ["Second greeting", "Third greeting"],
        },
    ).json()
    _profile, session = create_profile_and_session(client, character_id=character["id"])

    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    assert [message["content"] for message in tree["messages"]] == [
        "First greeting",
        "Second greeting",
        "Third greeting",
    ]
    assert all(message["parent_id"] is None for message in tree["messages"])
    assert tree["active_path_ids"] == [tree["messages"][0]["id"]]
