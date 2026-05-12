from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

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

    monkeypatch.setenv("OPENAI_API_KEY", "test-key")
    monkeypatch.setattr(providers, "stream_completion", fake_stream_completion)

    app = create_app(init_on_startup=False)
    app.dependency_overrides[get_db] = override_db
    client = TestClient(app)

    profile = client.post(
        "/api/api-profiles",
        json={
            "name": "Mock",
            "provider_type": "openai_responses",
            "base_url": "https://example.test",
            "model": "mock-model",
            "api_key_env": "OPENAI_API_KEY",
            "default_params": {},
        },
    ).json()
    character = client.post("/api/characters", json={"name": "Luna", "first_mes": "Hi."}).json()
    session = client.post(
        "/api/sessions",
        json={"title": "Session", "character_id": character["id"], "api_profile_id": profile["id"], "preset": {"auto_greeting": True}},
    ).json()
    tree = client.get(f"/api/sessions/{session['id']}/tree").json()
    assert tree["active_path_ids"]

    client.post(
        f"/api/sessions/{session['id']}/messages",
        json={"role": "user", "speaker": "User", "content": "Hello", "status": "complete"},
    )
    with client.stream("POST", f"/api/sessions/{session['id']}/generate/stream", json={}) as response:
        body = "".join(response.iter_text())
    assert "message_created" in body
    assert "Mock " in body
    assert "message_completed" in body
