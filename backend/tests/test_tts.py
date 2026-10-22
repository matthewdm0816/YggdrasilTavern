from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import models
from app.api.tts import _until_disconnected
from app.config import Settings
from app.database import Base, Database
from app.main import create_app
from app.services import tts


AUDIO = b"ID3\x04\x00\x00test-mp3"
SECRET = "private-tts-test-secret"


@pytest.fixture
def environment():
    database = Database("sqlite:///:memory:")
    Base.metadata.create_all(database.engine)
    app = create_app(init_on_startup=False, database=database, settings=Settings(_env_file=None, auth_enabled=False))
    with TestClient(app) as client:
        with database.open_session() as db:
            session = models.ChatSession(title="TTS fixture")
            db.add(session)
            db.flush()
            message = models.Message(session_id=session.id, role="assistant", status="complete", content='她笑着说：“你好！”', thinking_content='“不要朗读思考”')
            db.add(message)
            db.commit()
            message_id = message.id
        yield client, database, message_id
    database.dispose()


def save(client, **changes):
    current = client.get("/api/settings/tts").json()
    body = {key: value for key, value in current.items() if key not in {"revision", "has_api_key"}}
    body.update(expected_revision=current["revision"], **changes)
    return client.put("/api/settings/tts", json=body)


def ready(client, **changes):
    response = save(client, **{"enabled": True, "voice": "female-test", "api_key": SECRET, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def transport(monkeypatch, handler):
    original = httpx.AsyncClient

    def factory(**kwargs):
        assert kwargs["follow_redirects"] is False
        assert kwargs["timeout"].read == 90
        return original(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(tts.httpx, "AsyncClient", factory)


def test_default_settings_are_disabled_manual_and_do_not_create_a_row(environment):
    client, database, _ = environment
    response = client.get("/api/settings/tts")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "enabled": False, "provider": "minimax", "endpoint": "https://api.minimax.cn/v1/t2a_v2",
        "model": "speech-2.8-hd", "voice": "", "speed": 1.0, "volume": 1.0, "pitch": 0,
        "emotion": "", "language_boost": "auto", "text_mode": "dialogue", "trigger_mode": "manual",
        "instruct_model": True, "revision": 0, "has_api_key": False,
    }
    with database.open_session() as db:
        assert db.get(models.TtsSettings, "default") is None


def test_settings_secret_is_write_only_and_revision_prevents_stale_updates(environment):
    client, database, _ = environment
    data = ready(client)
    assert data["revision"] == 1
    assert data["has_api_key"]
    assert SECRET not in json.dumps(data)
    assert "api_key" not in data
    stale = client.put("/api/settings/tts", json={"expected_revision": 0})
    assert stale.status_code == 409
    assert save(client, api_key="", speed=1.2).status_code == 200
    with database.open_session() as db:
        assert db.get(models.TtsSettings, "default").api_key == SECRET
        assert db.get(models.TtsSettings, "default").speed == 1.2


@pytest.mark.parametrize("changes", [
    {"endpoint": "https://other.example/v1/t2a_v2"}, {"provider": "openai_compatible"},
])
def test_changing_provider_destination_requires_explicit_key_decision(environment, changes):
    client, database, _ = environment
    ready(client)
    denied = save(client, **changes)
    assert denied.status_code == 422
    assert "重新填写" in denied.text
    assert save(client, **changes, api_key="new-destination-secret").status_code == 200
    with database.open_session() as db:
        assert db.get(models.TtsSettings, "default").api_key == "new-destination-secret"
    assert save(client, enabled=False, clear_api_key=True).status_code == 200
    assert not client.get("/api/settings/tts").json()["has_api_key"]


def test_disabled_configuration_can_be_incomplete_and_key_clear_is_explicit(environment):
    client, _, _ = environment
    assert save(client, endpoint="", model="", voice="").status_code == 200
    assert save(client, enabled=True).status_code == 422
    response = save(client, api_key=SECRET, clear_api_key=True)
    assert response.status_code == 422
    assert SECRET not in response.text


@pytest.mark.parametrize("url", [
    "file:///tmp/tts", "https://name:password@example.test/speech", "https://example.test/speech?api_key=secret",
    "https://example.test/speech#part", "https://example.test:bad/speech", "https://example.test/speech?",
    "https://exa mple.test/speech", "https://example.test\\@elsewhere/speech", "https://example.test\n/speech",
])
def test_invalid_endpoint_is_rejected_without_echoing_submitted_values(environment, url):
    client, _, _ = environment
    response = save(client, endpoint=url, api_key=SECRET)
    assert response.status_code == 422
    assert SECRET not in response.text
    assert "password@example" not in response.text


@pytest.mark.parametrize("key", ["secret\nheader", "含中文密钥", "two words", "control\x00character"])
def test_invalid_key_is_never_returned_in_validation(environment, key):
    client, _, _ = environment
    result = save(client, api_key=key)
    assert result.status_code == 422
    assert key not in result.text
    assert '"input"' not in result.text


def test_preview_uses_original_content_and_never_calls_provider(environment, monkeypatch):
    client, _, message_id = environment

    def forbidden(**kwargs):
        raise AssertionError("Preview must not create a provider connection")

    monkeypatch.setattr(tts.httpx, "AsyncClient", forbidden)
    response = client.post(f"/api/messages/{message_id}/tts/preview")
    assert response.status_code == 200
    assert response.json()["text"] == "你好！"
    assert response.json()["segments"] == ["你好！"]
    assert response.json()["max_characters"] == 9999
    assert "思考" not in response.json()["text"]
    tags = client.post(f"/api/messages/{message_id}/tts/preview", json={"mode": "tags"})
    assert tags.status_code == 200
    assert tags.json()["text"] == ""
    assert tags.json()["warnings"]


@pytest.mark.parametrize("role,status,expected", [("user", "complete", 422), ("system", "complete", 422), ("assistant", "streaming", 409), ("assistant", "cancelled", 409), ("assistant", "failed", 409)])
def test_only_complete_assistant_messages_can_be_previewed_or_spoken(environment, role, status, expected):
    client, database, message_id = environment
    with database.open_session() as db:
        message = db.get(models.Message, message_id)
        message.role, message.status = role, status
        db.commit()
    for suffix in ("/tts", "/tts/preview"):
        assert client.post(f"/api/messages/{message_id}{suffix}", json={}).status_code == expected
    assert client.post("/api/messages/missing/tts", json={}).status_code == 404


def test_speech_requires_enabled_settings_before_calling_provider(environment, monkeypatch):
    client, _, message_id = environment

    def forbidden(**kwargs):
        raise AssertionError("Disabled TTS must not contact any provider")

    monkeypatch.setattr(tts.httpx, "AsyncClient", forbidden)
    assert client.post(f"/api/messages/{message_id}/tts", json={}).status_code == 409


def test_minimax_request_uses_native_fields_and_returns_uncached_mp3(environment, monkeypatch):
    client, _, message_id = environment
    ready(client, emotion="happy", volume=1.2, pitch=-2, speed=1.1)

    def handler(request):
        assert str(request.url) == "https://api.minimax.cn/v1/t2a_v2"
        assert request.headers["Authorization"] == f"Bearer {SECRET}"
        assert json.loads(request.content) == {
            "model": "speech-2.8-hd", "text": "你好！", "stream": False, "output_format": "hex",
            "voice_setting": {"voice_id": "female-test", "speed": 1.1, "vol": 1.2, "pitch": -2, "emotion": "happy"},
            "audio_setting": {"format": "mp3", "sample_rate": 32000, "bitrate": 128000, "channel": 1},
            "language_boost": "auto",
        }
        return httpx.Response(200, json={"base_resp": {"status_code": 0}, "data": {"status": 2, "audio": AUDIO.hex()}})

    transport(monkeypatch, handler)
    response = client.post(f"/api/messages/{message_id}/tts")
    assert response.status_code == 200, response.text
    assert response.content == AUDIO
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.headers["cache-control"] == "no-store"


def test_openai_compatible_request_uses_standard_fields_and_supports_keyless_local_service(environment, monkeypatch):
    client, database, message_id = environment
    ready(client, provider="openai_compatible", endpoint="http://127.0.0.1:8880/v1/audio/speech", model="tts-1", voice="alloy", api_key="", speed=3.0)

    def handler(request):
        assert "authorization" not in request.headers
        assert json.loads(request.content) == {"model": "tts-1", "input": "编辑后文字", "voice": "alloy", "speed": 3.0, "response_format": "mp3"}
        return httpx.Response(200, content=AUDIO, headers={"content-type": "audio/mpeg"})

    transport(monkeypatch, handler)
    response = client.post(f"/api/messages/{message_id}/tts", json={"text": "编辑后文字"})
    assert response.status_code == 200, response.text
    assert response.content == AUDIO
    with database.open_session() as db:
        assert db.get(models.Message, message_id).content == '她笑着说：“你好！”'


def test_empty_and_overlong_text_is_not_sent_or_silently_truncated(environment, monkeypatch):
    client, database, message_id = environment
    ready(client, provider="openai_compatible", endpoint="https://example.test/v1/audio/speech", model="tts-1", voice="alloy")

    def forbidden(**kwargs):
        raise AssertionError("Invalid text must not call provider")

    monkeypatch.setattr(tts.httpx, "AsyncClient", forbidden)
    for text in ("", "  ", "长" * 4097):
        response = client.post(f"/api/messages/{message_id}/tts", json={"text": text})
        assert response.status_code == 422
    with database.open_session() as db:
        db.get(models.Message, message_id).content = "“" + "长" * 4100 + "”"
        db.commit()
    preview = client.post(f"/api/messages/{message_id}/tts/preview").json()
    assert len(preview["text"]) == 4100
    assert preview["warnings"]
    assert preview["max_characters"] == 4096


@pytest.mark.parametrize("response,expected", [
    (httpx.Response(200, json={"base_resp": {"status_code": 1004, "status_msg": f"invalid {SECRET}"}, "trace_id": "trace-test"}), "1004"),
    (httpx.Response(200, json={"data": {"audio": AUDIO.hex(), "status": 2}}), "base_resp"),
    (httpx.Response(200, json={"base_resp": {"status_code": 0}, "data": {"status": 1, "audio": AUDIO.hex()}}), "data.status"),
    (httpx.Response(200, json={"base_resp": {"status_code": 0}, "data": {"status": 2, "audio": "not-hex"}}), "十六进制"),
    (httpx.Response(200, json={"base_resp": {"status_code": 0}, "data": {"status": 2, "audio": ""}}), "音频为空"),
    (httpx.Response(200, json={"base_resp": {"status_code": 0}, "data": {"status": 2, "audio": b"not mp3".hex()}}), "MP3"),
    (httpx.Response(200, content=b"<html>bad gateway</html>"), "JSON"),
    (httpx.Response(200, json=[]), "JSON 对象"),
    (httpx.Response(401, json={"error": f"Bearer {SECRET}"}), "HTTP 401"),
    (httpx.Response(302, headers={"location": "https://other.example/steal"}), "重定向"),
])
def test_provider_failures_are_visible_without_leaking_key(environment, monkeypatch, response, expected):
    client, _, message_id = environment
    ready(client)
    transport(monkeypatch, lambda request: response)
    result = client.post(f"/api/messages/{message_id}/tts", json={})
    assert result.status_code == 502, result.text
    assert expected in result.json()["detail"]
    assert SECRET not in result.text


def test_transport_timeout_and_response_size_limit(environment, monkeypatch):
    client, _, message_id = environment
    ready(client)

    def timed_out(request):
        raise httpx.ReadTimeout(f"timeout {SECRET}", request=request)

    transport(monkeypatch, timed_out)
    result = client.post(f"/api/messages/{message_id}/tts")
    assert result.status_code == 504
    assert "超时" in result.text
    assert SECRET not in result.text


def test_transport_rejects_large_response(environment, monkeypatch):
    client, _, message_id = environment
    ready(client)
    monkeypatch.setattr(tts, "MAX_JSON_BYTES", 30)
    transport(monkeypatch, lambda request: httpx.Response(200, content=b"x" * 40))
    result = client.post(f"/api/messages/{message_id}/tts")
    assert result.status_code == 502
    assert "上限" in result.text


def test_openai_rejects_json_disguised_as_success(environment, monkeypatch):
    client, _, message_id = environment
    ready(client, provider="openai_compatible", endpoint="https://example.test/v1/audio/speech", model="tts-1", voice="alloy")
    transport(monkeypatch, lambda request: httpx.Response(200, json={"error": f"bad key {SECRET}"}))
    response = client.post(f"/api/messages/{message_id}/tts")
    assert response.status_code == 502
    assert "未返回 MP3" in response.text
    assert SECRET not in response.text


def test_minimax_voices_can_be_fetched_while_disabled(environment, monkeypatch):
    client, _, _ = environment
    assert save(client, api_key=SECRET, model="", voice="").status_code == 200

    def handler(request):
        assert str(request.url) == "https://api.minimax.cn/v1/get_voice"
        assert json.loads(request.content) == {"voice_type": "all"}
        return httpx.Response(200, json={
            "base_resp": {"status_code": 0},
            "system_voice": [{"voice_id": "voice-1", "voice_name": "Test", "description": ["中文", "平静"]}],
            "voice_cloning": [{"voice_id": "own-voice"}], "voice_generation": [],
        })

    transport(monkeypatch, handler)
    result = client.post("/api/tts/voices")
    assert result.status_code == 200, result.text
    assert result.json()["voices"] == [
        {"id": "voice-1", "name": "Test", "description": "中文、平静", "kind": "system"},
        {"id": "own-voice", "name": "own-voice", "description": "", "kind": "cloned"},
    ]


@pytest.mark.asyncio
async def test_browser_disconnect_cancels_pending_provider_operation():
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def provider():
        started.set()
        try:
            await asyncio.Future()
        finally:
            cancelled.set()

    class Disconnected:
        async def is_disconnected(self):
            await started.wait()
            return True

    with pytest.raises(HTTPException) as error:
        await _until_disconnected(Disconnected(), provider())
    assert error.value.status_code == 499
    assert cancelled.is_set()


def test_tts_configuration_credentials_and_messages_are_isolated_per_account(tmp_path, monkeypatch):
    app = create_app(settings=Settings(_env_file=None, database_url=f"sqlite:///{(tmp_path / 'owner.db').as_posix()}", auth_enabled=False))
    password = "test-account-password"
    seen_keys = []

    def handler(request):
        seen_keys.append(request.headers["authorization"])
        return httpx.Response(200, json={"base_resp": {"status_code": 0}, "data": {"status": 2, "audio": AUDIO.hex()}})

    transport(monkeypatch, handler)
    with TestClient(app) as owner:
        assert owner.post("/api/auth/setup", json={"username": "owner", "password": password}).status_code == 200
        assert owner.post("/api/auth/users", json={"username": "alice", "password": password}).status_code == 200
        ready(owner, api_key="owner-secret")
        with TestClient(app) as alice:
            assert alice.post("/api/auth/login", json={"username": "alice", "password": password}).status_code == 200
            assert not alice.get("/api/settings/tts").json()["has_api_key"]
            ready(alice, api_key="alice-secret", voice="alice-voice")
            character = alice.post("/api/characters", json={"name": "Alice", "first_mes": "“Alice text”"}).json()
            session = alice.post("/api/sessions", json={"character_id": character["id"]}).json()
            message_id = alice.get(f"/api/sessions/{session['id']}/tree").json()["messages"][0]["id"]
            assert owner.post(f"/api/messages/{message_id}/tts/preview").status_code == 404
            assert owner.post(f"/api/messages/{message_id}/tts").status_code == 404
            assert alice.post(f"/api/messages/{message_id}/tts").status_code == 200
            assert seen_keys == ["Bearer alice-secret"]
            assert owner.get("/api/settings/tts").json()["voice"] == "female-test"
            for client in (owner, alice):
                settings = client.get("/api/settings/tts").text
                assert "owner-secret" not in settings and "alice-secret" not in settings
