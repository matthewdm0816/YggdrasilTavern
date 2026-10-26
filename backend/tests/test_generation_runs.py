from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models, schemas
from app.api.generation import GenerationStreamingResponse
from app.database import Base, Database, get_db
from app.main import create_app
from app.services import generation as generation_service, providers
from app.services.generation import start_generation
from app.services.token_counter import count_text_tokens
from app.services.tree import create_message


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
    assert run_detail["parameters"]["temperature"] == 0.7
    assert run_detail["parameters"]["_yggdrasil_token_limits"]["configured_input_tokens"] == 262144
    assert run_detail["parameters"]["_yggdrasil_token_limits"]["configured_output_tokens"] == 32768
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
    assert body.startswith("event: message_created\ndata: ")
    assert "\n\nevent: message_completed\ndata: " in body

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


def test_preview_and_generation_share_the_same_trimmed_active_path(monkeypatch):
    client, testing_session = make_client()
    profile = client.post(
        "/api/api-profiles",
        json={
            "name": "Small context",
            "provider_type": "openai_chat_completions",
            "base_url": "https://example.test",
            "model": "mock-model",
            "api_key": "test-key",
            "input_token_limit": 1024,
            "output_token_limit": 128,
        },
    ).json()
    character = client.post("/api/characters", json={"name": "Context", "first_mes": ""}).json()
    session = client.post(
        "/api/sessions",
        json={"title": "Context", "character_id": character["id"], "api_profile_id": profile["id"]},
    ).json()
    for index in range(8):
        client.post(
            f"/api/sessions/{session['id']}/messages",
            json={
                "role": "user" if index % 2 == 0 else "assistant",
                "speaker": "User" if index % 2 == 0 else "Context",
                "content": f"history-{index} " + ("context words " * 100),
            },
        )

    preview = client.post(
        f"/api/sessions/{session['id']}/context/preview",
        json={"api_profile_id": profile["id"]},
    ).json()
    assert preview["dropped_history_count"] > 0
    assert preview["estimated_input_tokens"] <= preview["effective_input_token_limit"] == 1024
    assert "history-6" in preview["messages"][-2]["content"]
    assert "history-7" in preview["messages"][-1]["content"]

    seen_messages: list[dict[str, str]] = []

    async def recording_stream(profile, context):
        seen_messages.extend(item.model_dump() for item in context.messages)
        yield providers.ProviderStreamEvent(kind="text", delta="trimmed")

    monkeypatch.setattr(providers, "stream_completion", recording_stream)
    with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
        assert "message_completed" in "".join(response.iter_text())
    assert seen_messages == preview["messages"]

    with testing_session() as db:
        run = db.scalars(select(models.GenerationRun)).one()
        limits = run.parameters["_yggdrasil_token_limits"]
        assert limits["effective_input_tokens"] == 1024
        assert limits["effective_output_tokens"] == 128



def test_parallel_generation_needs_only_a_finished_parent(monkeypatch):
    client, testing_session = make_client()
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    _profile, session = create_profile_and_session(client)
    tree_url = f"/api/sessions/{session['id']}/tree"
    generate_url = f"/api/sessions/{session['id']}/generate/stream"
    prompt = client.post(
        f"/api/sessions/{session['id']}/messages", json={"role": "user", "content": "first prompt"},
    ).json()
    with testing_session() as db:
        streaming = create_message(
            db, db.get(models.ChatSession, session["id"]), parent_id=prompt["id"],
            role="assistant", content="partial", status="streaming",
        )
        db.add(models.GenerationRun(
            session_id=session["id"], output_message_id=streaming.id, provider_type="openai_responses",
            model="mock-model", prompt_hash="0" * 64, status="streaming",
        ))
        db.commit()
        streaming_id = streaming.id
    before = client.get(tree_url).json()

    # The session path now ends at the streaming reply, so nothing may start or append below it.
    for refused in (
        client.post(generate_url, json={}),
        client.post(generate_url, json={"parent_message_id": streaming_id}),
        client.post(f"/api/sessions/{session['id']}/messages", json={"role": "user", "content": "too early"}),
    ):
        assert refused.status_code == 409
        assert "还在生成" in refused.json()["detail"]
    both = client.post(generate_url, json={"parent_message_id": prompt["id"], "regenerate_message_id": streaming_id})
    assert both.status_code == 400
    after = client.get(tree_url).json()
    assert after["active_path_ids"] == before["active_path_ids"]
    assert [message["id"] for message in after["messages"]] == [message["id"] for message in before["messages"]]

    seen_contexts: list[list[str]] = []

    async def parallel_stream(profile, context):
        seen_contexts.append([message.content for message in context.messages])
        yield providers.ProviderStreamEvent(kind="text", delta="parallel reply")

    monkeypatch.setattr(providers, "stream_completion", parallel_stream)
    with client.stream("POST", generate_url, json={"parent_message_id": prompt["id"]}) as response:
        assert "message_completed" in "".join(response.iter_text())
    assert seen_contexts == [["first prompt"]]
    tree = client.get(tree_url).json()
    parallel = next(message for message in tree["messages"] if message["content"] == "parallel reply")
    assert parallel["parent_id"] == prompt["id"]
    assert tree["active_path_ids"] == [prompt["id"], parallel["id"]]
    assert next(message for message in tree["messages"] if message["id"] == streaming_id)["status"] == "streaming"
    with testing_session() as db:
        assert sorted(run.status for run in db.scalars(select(models.GenerationRun))) == ["complete", "streaming"]


@pytest.mark.parametrize("terminal_status", ["complete", "failed", "cancelled"])
def test_terminal_generation_allows_next_run(monkeypatch, terminal_status):
    client, testing_session = make_client()
    _profile, session = create_profile_and_session(client)
    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "content": "start"},
    )

    async def first_stream(profile, context):
        yield providers.ProviderStreamEvent(kind="text", delta="first partial")
        if terminal_status == "failed":
            raise RuntimeError("first provider failed")
        if terminal_status == "cancelled":
            raise asyncio.CancelledError()

    monkeypatch.setattr(providers, "stream_completion", first_stream)
    if terminal_status == "cancelled":
        try:
            with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
                "".join(response.iter_text())
        except asyncio.CancelledError:
            pass
    else:
        with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
            body = "".join(response.iter_text())
        assert ("message_completed" if terminal_status == "complete" else "first provider failed") in body

    with testing_session() as db:
        first_run = db.scalars(select(models.GenerationRun)).one()
        assert first_run.status == terminal_status

    async def next_stream(profile, context):
        yield providers.ProviderStreamEvent(kind="text", delta="second complete")

    monkeypatch.setattr(providers, "stream_completion", next_stream)
    with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
        assert "message_completed" in "".join(response.iter_text())

    with testing_session() as db:
        runs = list(db.scalars(select(models.GenerationRun)))
        assert len(runs) == 2
        assert {run.status for run in runs} == {terminal_status, "complete"}


@pytest.mark.asyncio
async def test_response_cancelled_before_first_event_releases_generation_slot(monkeypatch):
    client, testing_session = make_client()
    _profile, session = create_profile_and_session(client)
    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "content": "start"},
    )

    with testing_session() as db:
        handle = await start_generation(session["id"], schemas.GenerateRequest(), db)
        response = GenerationStreamingResponse(handle)

        async def receive():
            return {"type": "http.request", "body": b"", "more_body": False}

        async def send(message):
            assert message["type"] == "http.response.start"
            raise asyncio.CancelledError()

        with pytest.raises(asyncio.CancelledError):
            await response(
                {"type": "http", "asgi": {"spec_version": "2.4"}, "method": "POST", "path": "/api/generate"},
                receive,
                send,
            )

        run = db.get(models.GenerationRun, handle.run_id)
        message = db.get(models.Message, handle.output_message_id)
        assert run is not None and run.status == "interrupted"
        assert run.completed_at is not None
        assert message is not None and message.status == "interrupted"

    async def next_stream(profile, context):
        yield providers.ProviderStreamEvent(kind="text", delta="next reply")

    monkeypatch.setattr(providers, "stream_completion", next_stream)
    with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
        assert "message_completed" in "".join(response.iter_text())


def test_simultaneous_starts_from_one_message_create_sibling_replies(tmp_path, monkeypatch):
    database = Database(f"sqlite:///{(tmp_path / 'generation-race.db').as_posix()}")
    Base.metadata.create_all(database.engine)
    with database.open_session() as db:
        character = models.Character(name="Race", first_mes="")
        profile = models.APIProfile(
            name="Race profile",
            provider_type="openai_responses",
            base_url="https://example.test",
            model="mock-model",
            api_key="test-key",
            default_params={},
        )
        db.add_all([character, profile])
        db.flush()
        session = models.ChatSession(
            title="Race",
            character_id=character.id,
            api_profile_id=profile.id,
            preset={},
        )
        db.add(session)
        db.commit()
        session_id = session.id
        prompt_id = create_message(db, session, parent_id=None, role="user", content="race").id

    entered = Barrier(2)
    both_started = Barrier(2)
    original_serialize = generation_service.serialize_session_writes

    def synchronized_start(db, session):
        entered.wait(timeout=10)
        return original_serialize(db, session)

    monkeypatch.setattr(generation_service, "serialize_session_writes", synchronized_start)

    def start_one():
        with database.open_session() as db:
            # The client names the parent; the session path end becomes the first streaming reply.
            request = schemas.GenerateRequest(parent_message_id=prompt_id)
            handle = asyncio.run(generation_service.start_generation(session_id, request, db))
            try:
                # Both runs must stream at the same time before either closes.
                both_started.wait(timeout=10)
                return handle.output_message_id
            finally:
                asyncio.run(handle.aclose())

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(start_one), pool.submit(start_one)]
            reply_ids = [future.result(timeout=20) for future in futures]

        assert len(set(reply_ids)) == 2
        with database.open_session() as db:
            runs = list(db.scalars(select(models.GenerationRun)))
            assert len(runs) == 2
            assert {run.status for run in runs} == {"interrupted"}
            replies = [db.get(models.Message, reply_id) for reply_id in reply_ids]
            assert {reply.parent_id for reply in replies} == {prompt_id}
    finally:
        database.dispose()
