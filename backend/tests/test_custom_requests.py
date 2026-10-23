import json

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.api.profiles import create_api_profile, discover_api_profile_models, update_api_profile
from app.database import Base, create_database_engine
from app.services import providers
from app.services.provider_protocols.transport import safe_error_text


@pytest.fixture
def db():
    engine = create_database_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.info["allow_server_credentials"] = False
        yield session
    engine.dispose()


def payload(**changes):
    return schemas.APIProfileCreate.model_validate({
        "name": "Synthetic", "provider_type": "openai_chat_completions", "base_url": "https://provider.test",
        "model": "synthetic", "api_key": "synthetic-key", **changes,
    })


def profile(provider_type="openai_chat_completions", **changes):
    result = models.APIProfile(name="Synthetic", provider_type=provider_type, base_url="https://provider.test",
                               model="synthetic", api_key="synthetic-key", api_key_env="", default_params={},
                               input_token_limit=8192, output_token_limit=128, model_catalog=[])
    # Setting attributes keeps the red test executable against the older model.
    result.custom_headers = {}
    result.excluded_body_params = []
    result.anthropic_prompt_cache = False
    for name, value in changes.items():
        setattr(result, name, value)
    return result


def context():
    return schemas.ContextPreviewOut(system="System", messages=[schemas.PromptMessage(role="user", content="Hello")],
                                     activated_lore=[], compiled_blocks=[])


def mock_http(monkeypatch, handler):
    original = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kwargs: original(transport=transport, **kwargs))


def test_profile_headers_are_write_only_and_case_insensitive_patches_preserve_others(db):
    saved = create_api_profile(payload(custom_headers={"X-Tenant": "private-tenant", "X-Session": "private-session"},
                                       excluded_body_params=["temperature"], anthropic_prompt_cache=True), db)
    output = schemas.APIProfileOut.model_validate(saved).model_dump(mode="json")
    assert output["custom_header_names"] == ["X-Tenant", "X-Session"]
    assert "private-tenant" not in json.dumps(output)
    assert "custom_headers" not in output
    assert output["excluded_body_params"] == ["temperature"]
    assert output["anthropic_prompt_cache"] is True
    update_api_profile(saved.id, schemas.APIProfileUpdate.model_validate({"custom_headers": {"x-tenant": "new-tenant"}}), db)
    assert {name.lower(): value for name, value in saved.custom_headers.items()} == {
        "x-tenant": "new-tenant", "x-session": "private-session",
    }
    update_api_profile(saved.id, schemas.APIProfileUpdate(name="Renamed"), db)
    assert saved.custom_headers["X-Session"] == "private-session"
    update_api_profile(saved.id, schemas.APIProfileUpdate.model_validate({"custom_headers": {"X-TENANT": None}}), db)
    assert saved.custom_headers == {"X-Session": "private-session"}


@pytest.mark.parametrize("headers", [{"Bad Name": "value"}, {"X-Key": "secret\r\nInjected: yes"},
                                          {"X-Key": ""}, {"X-Key": "秘密"}])
def test_invalid_headers_are_rejected_without_values_in_validation_message(headers):
    with pytest.raises(ValidationError) as exc:
        payload(custom_headers=headers)
    assert all(value not in error["msg"] for value in headers.values() if value
               for error in exc.value.errors())


def test_routing_change_requires_explicit_header_replacement(db):
    saved = create_api_profile(payload(custom_headers={"X-Tenant": "private-tenant"}), db)
    with pytest.raises(HTTPException) as exc:
        update_api_profile(saved.id, schemas.APIProfileUpdate(base_url="https://other.test", api_key="new-key"), db)
    assert exc.value.status_code == 422
    update_api_profile(saved.id, schemas.APIProfileUpdate.model_validate({
        "base_url": "https://other.test", "api_key": "new-key", "custom_headers": {"x-tenant": None},
    }), db)
    assert saved.custom_headers == {}


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_type", ["openai_chat_completions", "openai_responses", "anthropic_messages"])
@pytest.mark.parametrize("api_key", ["synthetic-key", None])
async def test_custom_headers_body_and_final_exclusions_reach_each_protocol(monkeypatch, provider_type, api_key):
    auth_name = "X-Api-Key" if provider_type == "anthropic_messages" else "aUtHoRiZaTiOn"
    item = profile(provider_type, api_key=api_key, custom_headers={auth_name: "custom-secret", "X-Tenant": "tenant-secret"},
                   default_params={"custom_flag": {"enabled": True}, "temperature": 0.4},
                   excluded_body_params=["temperature", "stream_options", "max_tokens", "max_completion_tokens", "max_output_tokens"])

    def handler(request):
        assert request.headers[auth_name] == "custom-secret"
        assert request.headers["x-tenant"] == "tenant-secret"
        assert len([name for name, _ in request.headers.multi_items() if name.lower() == auth_name.lower()]) == 1
        body = json.loads(request.content)
        assert body["custom_flag"] == {"enabled": True}
        assert all(name not in body for name in item.excluded_body_params)
        return httpx.Response(200, text="data: [DONE]\n\n")

    mock_http(monkeypatch, handler)
    assert [event async for event in providers.stream_completion(item, context())] == []


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_type", ["openai_chat_completions", "openai_responses", "anthropic_messages"])
async def test_discovery_merges_custom_headers_for_each_protocol(monkeypatch, provider_type):
    item = profile(provider_type, custom_headers={"X-Route": "private-route", "ANTHROPIC-VERSION": "2023-06-01"})

    def handler(request):
        assert request.headers["x-route"] == "private-route"
        assert request.headers["anthropic-version"] == "2023-06-01"
        assert request.method == "GET"
        return httpx.Response(200, json={"data": [{"id": "found"}]})

    mock_http(monkeypatch, handler)
    assert [model.id for model in await providers.refresh_models(item)] == ["found"]


@pytest.mark.asyncio
async def test_discovery_uses_saved_headers_and_ephemeral_patch_without_saving(db, monkeypatch):
    saved = create_api_profile(payload(custom_headers={"X-Tenant": "old", "X-Remove": "gone"}), db)

    def handler(request):
        assert request.headers["x-tenant"] == "preview"
        assert "x-remove" not in request.headers
        return httpx.Response(200, json={"data": [{"id": "found"}]})

    mock_http(monkeypatch, handler)
    result = await discover_api_profile_models(schemas.ModelsDiscoverIn.model_validate({
        "provider_type": saved.provider_type, "base_url": saved.base_url, "profile_id": saved.id,
        "custom_headers": {"x-tenant": "preview", "X-Remove": None},
    }), db)
    assert result.available is True
    assert saved.custom_headers == {"X-Tenant": "old", "X-Remove": "gone"}


@pytest.mark.asyncio
async def test_header_only_authentication_is_supported_for_an_ordinary_users_profile(db, monkeypatch):
    saved = create_api_profile(payload(api_key=None, custom_headers={"Authorization": "Bearer header-only"}), db)

    def handler(request):
        assert request.headers["authorization"] == "Bearer header-only"
        return httpx.Response(200, json={"data": []})

    mock_http(monkeypatch, handler)
    assert await providers.refresh_models(saved) == []


def test_provider_error_redacts_arbitrary_custom_header_values():
    text = safe_error_text("Failed route=private-route and api key secret-key", {"X-Route": "private-route", "Authorization": "Bearer secret-key"})
    assert "private-route" not in text
    assert "secret-key" not in text


def test_provider_error_redacts_escaped_custom_header_values():
    secret = 'private\\route"token'
    escaped_json = json.dumps(secret)[1:-1]
    escaped_repr = repr(secret)[1:-1]
    error = safe_error_text(f"JSON {escaped_json}; Python {escaped_repr}", {"X-Route": secret})
    assert escaped_json not in error
    assert escaped_repr not in error


@pytest.mark.asyncio
async def test_stream_provider_errors_are_redacted_using_merged_headers(monkeypatch):
    item = profile(custom_headers={"X-Tenant": "private-tenant"})
    mock_http(monkeypatch, lambda request: httpx.Response(400, json={"error": {"message": "Rejected private-tenant"}}))
    with pytest.raises(Exception) as exc:
        _ = [event async for event in providers.stream_completion(item, context())]
    assert "private-tenant" not in str(exc.value)


@pytest.mark.asyncio
async def test_discovery_does_not_forward_saved_header_values_to_a_changed_host(db, monkeypatch):
    saved = create_api_profile(payload(custom_headers={"X-Tenant": "private-tenant"}), db)
    mock_http(monkeypatch, lambda request: pytest.fail("A changed host must not receive saved header values"))
    result = await discover_api_profile_models(schemas.ModelsDiscoverIn.model_validate({
        "provider_type": saved.provider_type, "base_url": "https://changed.test", "profile_id": saved.id,
        "api_key": "replacement-key",
    }), db)
    assert result.available is False
    assert "自定义请求头" in result.message
    assert "private-tenant" not in result.message


@pytest.mark.asyncio
async def test_custom_header_change_invalidates_model_catalog(db):
    saved = create_api_profile(payload(custom_headers={"X-Tenant": "old"}), db)
    saved.model_catalog = [{"id": "old-model"}]
    saved.models_refreshed_at = models.utc_now()
    db.commit()
    update_api_profile(saved.id, schemas.APIProfileUpdate.model_validate({"custom_headers": {"X-Tenant": "new"}}), db)
    assert saved.model_catalog == []
    assert saved.models_refreshed_at is None


@pytest.mark.asyncio
async def test_generation_metadata_stores_header_names_without_values(db, monkeypatch):
    from app.services import generation
    from app.services.provider_protocols.transport import ProviderStreamEvent

    saved = create_api_profile(payload(custom_headers={"X-Tenant": "private-tenant"}), db)
    character = models.Character(name="Synthetic")
    db.add(character)
    db.flush()
    session = models.ChatSession(title="Synthetic", character_id=character.id, api_profile_id=saved.id)
    db.add(session)
    db.commit()
    prompt = context()
    monkeypatch.setattr(generation, "build_limited_context", lambda *args, **kwargs: prompt)
    monkeypatch.setattr(generation, "count_text_tokens", lambda content, model=None: len(content))

    async def stream(*args):
        yield ProviderStreamEvent(kind="text", delta="Partial reply")
        yield ProviderStreamEvent(kind="usage", usage={"input_tokens": 12, "output_tokens": 2})

    monkeypatch.setattr(providers, "stream_completion", stream)
    handle = await generation.start_generation(session.id, schemas.GenerateRequest(), db)
    events = [event async for event in handle.events]
    run = db.get(models.GenerationRun, handle.run_id)
    serialized = json.dumps(schemas.GenerationRunOut.model_validate(run).model_dump(mode="json"))
    assert "private-tenant" not in serialized
    assert run.parameters["_yggdrasil_request_settings"]["custom_header_names"] == ["X-Tenant"]
    assert "private-tenant" not in json.dumps([event.data for event in events])
    assert db.get(models.Message, handle.output_message_id).content == "Partial reply"


@pytest.mark.asyncio
async def test_changing_protocol_to_header_auth_removes_old_key_before_sending(db, monkeypatch):
    db.info["allow_server_credentials"] = True
    saved = create_api_profile(payload(api_key="old-private-key", api_key_env="OLD_PRIVATE_ENV"), db)
    update_api_profile(saved.id, schemas.APIProfileUpdate.model_validate({
        "provider_type": "anthropic_messages", "base_url": "https://new-provider.test",
        "custom_headers": {"Authorization": "Bearer replacement"},
    }), db)
    sent = []

    def handler(request):
        sent.append(dict(request.headers))
        return httpx.Response(200, json={"data": []})

    mock_http(monkeypatch, handler)
    await providers.refresh_models(saved)
    assert "old-private-key" not in json.dumps(sent)
    assert saved.api_key is None
    assert saved.api_key_env == ""
    assert sent[0]["authorization"] == "Bearer replacement"
    assert "x-api-key" not in sent[0]


@pytest.mark.parametrize("custom_headers", [
    {"Bad Name": "private-validation-secret"},
    {"X-Key": "private-validation-secret\r\nInjected: yes"},
    {"X-Key": ["private-validation-secret"]},
    ["private-validation-secret"],
])
def test_http_validation_errors_never_echo_custom_header_values(db, monkeypatch, custom_headers):
    from fastapi.testclient import TestClient
    from app.config import Settings
    from app.database import Database, get_db

    settings = Settings(_env_file=None, database_url="sqlite:///:memory:", auth_enabled=False)
    monkeypatch.setattr("app.config.get_settings", lambda: settings)
    from app.main import create_app

    app = create_app(init_on_startup=False, settings=settings, database=Database("sqlite:///:memory:"))
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as client:
        response = client.post("/api/api-profiles", json={
            "name": "Synthetic", "provider_type": "openai_chat_completions", "base_url": "https://provider.test",
            "model": "synthetic", "api_key": "direct-private-validation-secret", "custom_headers": custom_headers,
        })
    assert response.status_code == 422
    assert "private-validation-secret" not in response.text
    assert all("input" not in error for error in response.json()["detail"])


@pytest.mark.parametrize("method", ["post", "patch"])
@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity", "1e309"])
def test_http_rejects_nested_nonfinite_body_params_before_persistence(db, monkeypatch, method, number):
    from fastapi.testclient import TestClient
    from app.config import Settings
    from app.database import Database, get_db

    settings = Settings(_env_file=None, database_url="sqlite:///:memory:", auth_enabled=False)
    monkeypatch.setattr("app.config.get_settings", lambda: settings)
    from app.main import create_app

    app = create_app(init_on_startup=False, settings=settings, database=Database("sqlite:///:memory:"))
    app.dependency_overrides[get_db] = lambda: db
    original = create_api_profile(payload(default_params={"temperature": 0.7}), db) if method == "patch" else None
    document = {
        "name": "Synthetic", "provider_type": "openai_chat_completions", "base_url": "https://provider.test",
        "model": "synthetic", "api_key": "private-nonfinite-secret",
        "custom_headers": {"X-Tenant": "private-nonfinite-secret"},
        "default_params": {"nested": [{"value": "NONFINITE_SENTINEL"}], "private": "private-nonfinite-secret"},
    }
    body = json.dumps(document).replace('"NONFINITE_SENTINEL"', number)
    endpoint = f"/api/api-profiles/{original.id}" if original else "/api/api-profiles"
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.request(method.upper(), endpoint, content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 422
    assert "private-nonfinite-secret" not in response.text
    assert all("input" not in error for error in response.json()["detail"])
    db.expire_all()
    if original:
        assert db.get(models.APIProfile, original.id).default_params == {"temperature": 0.7}
    else:
        assert list(db.scalars(select(models.APIProfile))) == []


def test_body_params_keep_finite_numbers_and_json_values(db):
    params = {"big": 1e308, "small": -1e308, "nested": [0.7, True, None, {"literal": "NaN", "zero": 0}]}
    saved = create_api_profile(payload(default_params=params), db)
    assert saved.default_params == params
    updated = {"nested": {"number": 1.25, "literal": "Infinity"}}
    update_api_profile(saved.id, schemas.APIProfileUpdate(default_params=updated), db)
    assert saved.default_params == updated
