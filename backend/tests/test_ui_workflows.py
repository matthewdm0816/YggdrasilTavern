import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models, schemas
from app.config import Settings
from app.database import Base, get_db
from app.main import create_app
from app.services import providers
from app.services.errors import ApplicationError
from app.services.provider_protocols.transport import provider_error_detail


@pytest.fixture
def client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    app = create_app(init_on_startup=False, settings=Settings(_env_file=None, auth_enabled=False))
    app.state.ui_test_session_factory = factory

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    with TestClient(app) as api:
        yield api
    engine.dispose()


def profile(client):
    response = client.post("/api/api-profiles", json={
        "name": "Existing", "provider_type": "openai_chat_completions",
        "base_url": "https://provider.test/v1", "model": "manual-model", "api_key": "saved-key",
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_edit_updates_original_message_without_adding_swipes_or_changing_descendants(client):
    character = client.post("/api/characters", json={"name": "Editor", "first_mes": "original"}).json()
    session = client.post("/api/sessions", json={"character_id": character["id"]}).json()
    child = client.post(f"/api/sessions/{session['id']}/messages", json={"role": "user", "content": "child"}).json()
    before = client.get(f"/api/sessions/{session['id']}/tree").json()
    root = before["messages"][0]
    response = client.patch(f"/api/messages/{root['id']}", json={"content": "edited", "thinking_content": "edited thinking"})
    assert response.status_code == 200, response.text
    after = client.get(f"/api/sessions/{session['id']}/tree").json()
    assert after["active_path_ids"] == before["active_path_ids"]
    assert len(after["messages"]) == len(before["messages"])
    edited = next(item for item in after["messages"] if item["id"] == root["id"])
    assert edited["content"] == "edited"
    assert edited["thinking_content"] == "edited thinking"
    assert edited["selected_child_id"] == root["selected_child_id"]
    assert next(item for item in after["messages"] if item["id"] == child["id"])["parent_id"] == root["id"]


def test_edit_cannot_overwrite_streaming_message(client):
    character = client.post("/api/characters", json={"name": "Streaming", "first_mes": ""}).json()
    session = client.post("/api/sessions", json={"character_id": character["id"]}).json()
    message = client.post(f"/api/sessions/{session['id']}/messages", json={"role": "assistant", "content": "partial", "status": "streaming"}).json()
    assert client.patch(f"/api/messages/{message['id']}", json={"content": "edit"}).status_code == 409


def test_discovery_reuses_saved_key_without_saving_draft_or_sending_key_to_new_address(client, monkeypatch):
    saved = profile(client)
    seen = []

    async def discover(item):
        seen.append((item.api_key, item.base_url))
        return [schemas.RemoteModelInfo(id="listed-model")]

    monkeypatch.setattr(providers, "refresh_models", discover)
    draft = {"profile_id": saved["id"], "provider_type": saved["provider_type"], "base_url": saved["base_url"]}
    response = client.post("/api/api-profiles/models/discover", json=draft)
    assert response.status_code == 200
    assert response.json()["available"] is True
    assert seen == [("saved-key", saved["base_url"])]
    assert "saved-key" not in response.text
    assert client.get("/api/api-profiles").json()[0]["model"] == "manual-model"
    response = client.post("/api/api-profiles/models/discover", json={**draft, "base_url": "https://other.test"})
    assert response.json()["available"] is False
    assert len(seen) == 1
    response = client.post("/api/api-profiles/models/discover", json={**draft, "base_url": "https://other.test", "api_key": "replacement-key"})
    assert response.json()["available"] is True
    assert seen[-1] == ("replacement-key", "https://other.test")


def test_unavailable_model_list_returns_notice_and_keeps_cached_models_and_manual_model(client, monkeypatch):
    saved = profile(client)

    async def discover(item):
        return [schemas.RemoteModelInfo(id="cached-model")]

    monkeypatch.setattr(providers, "refresh_models", discover)
    assert client.post(f"/api/api-profiles/{saved['id']}/models/refresh").json()["available"] is True

    async def unsupported(item):
        raise ApplicationError(status_code=502, detail="该服务不支持远端模型列表")

    monkeypatch.setattr(providers, "refresh_models", unsupported)
    response = client.post(f"/api/api-profiles/{saved['id']}/models/refresh")
    assert response.status_code == 200
    assert response.json()["available"] is False
    assert "手动填写" in response.json()["message"]
    current = client.get("/api/api-profiles").json()[0]
    assert current["model_catalog"][0]["id"] == "cached-model"
    assert current["model"] == "manual-model"


def test_provider_error_contains_reason_context_and_redacts_credentials():
    response = httpx.Response(400, json={"error": {
        "message": "temperature not supported; key=saved-secret", "type": "invalid_request_error", "param": "temperature",
    }}, headers={"x-request-id": "request-123"})
    detail = provider_error_detail(response, url="https://user:password@provider.test/v1/chat/completions?api_key=url-secret", headers={"Authorization": "Bearer saved-secret"}, model="chosen-model")
    assert all(value in detail for value in ["HTTP 400", "temperature not supported", "temperature", "chosen-model", "request-123", "https://provider.test/v1/chat/completions"])
    assert all(value not in detail for value in ["saved-secret", "url-secret", "user:password"])


def test_replacing_key_clears_models_from_previous_account(client, monkeypatch):
    saved = profile(client)

    async def discover(item):
        return [schemas.RemoteModelInfo(id="previous-account-model")]

    monkeypatch.setattr(providers, "refresh_models", discover)
    client.post(f"/api/api-profiles/{saved['id']}/models/refresh")
    response = client.patch(f"/api/api-profiles/{saved['id']}", json={"api_key": "new-account-key"})
    assert response.status_code == 200
    assert response.json()["model_catalog"] == []
    assert response.json()["models_refreshed_at"] is None


@pytest.mark.parametrize("field,replacement", [("base_url", "https://new.test/v1"), ("api_key", "new-key")])
def test_in_flight_discovery_cannot_save_models_after_connection_changes(client, monkeypatch, field, replacement):
    saved = profile(client)

    async def discover(item):
        with client.app.state.ui_test_session_factory() as db:
            stored = db.get(models.APIProfile, saved["id"])
            setattr(stored, field, replacement)
            db.commit()
        return [schemas.RemoteModelInfo(id="old-connection-model")]

    monkeypatch.setattr(providers, "refresh_models", discover)
    response = client.post(f"/api/api-profiles/{saved['id']}/models/refresh")
    assert response.status_code == 200
    assert response.json()["available"] is False
    assert "已更改" in response.json()["message"]
    assert client.get("/api/api-profiles").json()[0]["model_catalog"] == []


def test_invalid_model_discovery_address_returns_notice(client, monkeypatch):
    async def invalid(item):
        raise httpx.InvalidURL("invalid endpoint")

    monkeypatch.setattr(providers, "refresh_models", invalid)
    response = client.post("/api/api-profiles/models/discover", json={"provider_type": "openai_chat_completions", "base_url": "https://[invalid", "api_key": "test-key"})
    assert response.status_code == 200
    assert response.json()["available"] is False


@pytest.mark.asyncio
async def test_real_transport_preserves_remote_400_reason(monkeypatch):
    real_client = httpx.AsyncClient
    transport = httpx.MockTransport(lambda request: httpx.Response(400, json={"error": {"message": "model unavailable", "code": "model_not_found"}}))
    monkeypatch.setattr("app.services.providers.httpx.AsyncClient", lambda **kwargs: real_client(transport=transport, **kwargs))
    item = models.APIProfile(name="Test", provider_type="openai_chat_completions", base_url="https://provider.test/v1", model="missing-model", api_key="test-secret", default_params={}, input_token_limit=262144, output_token_limit=32768)
    with pytest.raises(ApplicationError, match="model unavailable"):
        async for _ in providers.stream_completion(item, schemas.ContextPreviewOut(session_id="test", system="", messages=[], activated_lore=[], estimated_input_tokens=0)):
            pass
