from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import schemas
from app.database import Base, get_db
from app.main import create_app
from app.services import providers


def test_api_crud_tree_and_mock_stream(monkeypatch):
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    async def fake_stream_completion(profile, context):
        assert profile.model == "mock-model"
        assert context.messages[-1].content == "Hello"
        yield "Mock "
        yield "reply"

    async def fake_refresh_models(profile):
        assert profile.api_key == "sk-direct-test-secret"
        return [
            schemas.RemoteModelInfo(id="mock-model", max_total_tokens=262144),
            schemas.RemoteModelInfo(id="new-model"),
        ]

    monkeypatch.setattr(providers, "stream_completion", fake_stream_completion)
    monkeypatch.setattr(providers, "refresh_models", fake_refresh_models)

    app = create_app(init_on_startup=False)
    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)

    leaked_secret = "sk-should-never-appear-in-validation"
    invalid = client.post(
        "/api/api-profiles",
        json={
            "name": "Invalid",
            "provider_type": "openai_responses",
            "base_url": "https://example.test",
            "model": "mock-model",
            "api_key_env": leaked_secret,
        },
    )
    assert invalid.status_code == 422
    assert leaked_secret not in invalid.text
    assert '"input"' not in invalid.text

    invalid_limits = client.post(
        "/api/api-profiles",
        json={
            "name": "Invalid limits",
            "provider_type": "openai_responses",
            "base_url": "https://example.test",
            "model": "mock-model",
            "api_key": "test-secret",
            "input_token_limit": 100,
            "output_token_limit": 0,
        },
    )
    assert invalid_limits.status_code == 422

    profile = client.post(
        "/api/api-profiles",
        json={
            "name": "Mock",
            "provider_type": "openai_responses",
            "base_url": "https://example.test",
            "model": "mock-model",
            "api_key": "sk-direct-test-secret",
            "default_params": {},
        },
    ).json()
    assert profile["has_api_key"] is True
    assert "api_key" not in profile
    assert profile["input_token_limit"] == 262144
    assert profile["output_token_limit"] == 32768
    refreshed = client.post(f"/api/api-profiles/{profile['id']}/models/refresh").json()
    assert [item["id"] for item in refreshed["models"]] == ["mock-model", "new-model"]
    assert refreshed["models"][0]["max_total_tokens"] == 262144
    persisted_profile = client.get("/api/api-profiles").json()[0]
    assert persisted_profile["model_catalog"][0]["id"] == "mock-model"
    assert persisted_profile["models_refreshed_at"] is not None
    unsafe_reroute = client.patch(
        f"/api/api-profiles/{profile['id']}", json={"base_url": "https://other-provider.test"}
    )
    assert unsafe_reroute.status_code == 422
    assert "必须重新输入 API Key" in unsafe_reroute.text
    rerouted = client.patch(
        f"/api/api-profiles/{profile['id']}",
        json={"base_url": "https://other-provider.test", "api_key": "sk-reentered-test-secret"},
    )
    assert rerouted.status_code == 200
    assert rerouted.json()["base_url"] == "https://other-provider.test"
    character = client.post("/api/characters", json={"name": "Luna", "first_mes": "Hi."}).json()
    no_character = client.post("/api/sessions", json={"title": "Invalid"})
    assert no_character.status_code == 422
    session = client.post(
        "/api/sessions",
        json={"title": "", "character_id": character["id"], "preset": {"auto_greeting": True}},
    ).json()
    assert session["title"] == "Luna"
    assert session["api_profile_id"] is None
    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    assert tree["active_path_ids"]

    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "speaker": "User", "content": "Hello", "status": "complete"},
    )
    with client.stream(
        "POST",
        f"/api/sessions/{session['id']}/generate/stream",
        json={"api_profile_id": profile["id"]},
    ) as response:
        body = "".join(response.iter_text())
    assert "message_created" in body
    assert "Mock " in body
    assert "message_completed" in body

    in_use = client.delete(f"/api/characters/{character['id']}")
    assert in_use.status_code == 409
    assert "Chat session" in in_use.text
