import httpx
import pytest

from app.models import APIProfile
from app.services.providers import (
    _api_key,
    _stream_terminal_state,
    endpoint_for,
    extract_anthropic_delta,
    extract_anthropic_thinking_delta,
    extract_openai_chat_delta,
    extract_openai_chat_thinking_delta,
    extract_openai_responses_delta,
    extract_openai_responses_thinking_delta,
    extract_usage,
    models_endpoint_for,
    refresh_models,
)
from app.services.token_counter import reasoning_tokens_from_usage


def test_provider_delta_extractors():
    assert extract_anthropic_delta({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "hi"}}) == "hi"
    assert extract_openai_chat_delta({"choices": [{"delta": {"content": "hello"}}]}) == "hello"
    assert extract_openai_responses_delta({"type": "response.output_text.delta", "delta": "hey"}) == "hey"


def test_provider_thinking_and_usage_extractors():
    assert (
        extract_anthropic_thinking_delta({"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "hmm"}})
        == "hmm"
    )
    assert extract_openai_chat_thinking_delta({"choices": [{"delta": {"reasoning_content": "think"}}]}) == "think"
    assert extract_openai_responses_thinking_delta({"type": "response.reasoning_summary_text.delta", "delta": "summary"}) == "summary"
    assert extract_usage({"response": {"usage": {"input_tokens_details": {"cached_tokens": 12}}}}) == {
        "input_tokens_details": {"cached_tokens": 12}
    }


def test_stream_completion_markers_and_reasoning_aliases_are_normalized():
    assert _stream_terminal_state({"type": "message_stop"}) == (True, None)
    assert _stream_terminal_state({"type": "response.completed"}) == (True, None)
    assert _stream_terminal_state({"choices": [{"finish_reason": "stop"}]}) == (True, None)
    terminal, detail = _stream_terminal_state({"type": "response.failed", "error": {"message": "bad"}})
    assert terminal is True
    assert "bad" in (detail or "")
    usage = {
        "reasoning_tokens": 7,
        "completion_tokens_details": {"reasoning_tokens": 7},
        "output_tokens_details": {"reasoning_tokens": 7},
    }
    assert reasoning_tokens_from_usage(usage) == 7


def test_direct_key_precedes_legacy_env_and_v1_base_is_not_duplicated(monkeypatch):
    profile = APIProfile(
        name="Kimi",
        provider_type="openai_chat_completions",
        base_url="https://api.moonshot.cn/v1",
        model="kimi-k2",
        api_key="direct-secret",
        api_key_env="LEGACY_KIMI_KEY",
        default_params={},
    )
    monkeypatch.setenv("LEGACY_KIMI_KEY", "legacy-secret")
    assert _api_key(profile) == "direct-secret"
    assert endpoint_for(profile) == "https://api.moonshot.cn/v1/chat/completions"

    profile.api_key = None
    assert _api_key(profile) == "legacy-secret"


@pytest.mark.asyncio
async def test_refresh_models_ignores_completion_path_override(monkeypatch):
    profile = APIProfile(
        name="Compatible",
        provider_type="openai_chat_completions",
        base_url="https://provider.example/v1",
        path_override="/custom/chat/completions",
        model="old-model",
        api_key_env="TEST_MODEL_REFRESH_KEY",
        default_params={},
    )
    assert models_endpoint_for(profile) == "https://provider.example/v1/models"
    monkeypatch.setenv("TEST_MODEL_REFRESH_KEY", "secret-value")

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://provider.example/v1/models"
        assert request.headers["authorization"] == "Bearer secret-value"
        return httpx.Response(200, json={"data": [{"id": "new-a"}, {"id": "new-b"}, {"id": "new-a"}]})

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "app.services.providers.httpx.AsyncClient",
        lambda **kwargs: real_async_client(transport=transport, **kwargs),
    )
    assert await refresh_models(profile) == ["new-a", "new-b"]


@pytest.mark.asyncio
async def test_refresh_models_reports_unsupported_remote_endpoint(monkeypatch):
    profile = APIProfile(
        name="Anthropic",
        provider_type="anthropic_messages",
        base_url="https://anthropic.example",
        model="claude",
        api_key_env="TEST_ANTHROPIC_KEY",
        default_params={"anthropic_version": "2023-06-01"},
    )
    monkeypatch.setenv("TEST_ANTHROPIC_KEY", "secret-value")

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["x-api-key"] == "secret-value"
        assert request.headers["anthropic-version"] == "2023-06-01"
        return httpx.Response(404, text="not supported")

    transport = httpx.MockTransport(handler)
    real_async_client = httpx.AsyncClient
    monkeypatch.setattr(
        "app.services.providers.httpx.AsyncClient",
        lambda **kwargs: real_async_client(transport=transport, **kwargs),
    )
    with pytest.raises(Exception, match="不支持远端模型列表"):
        await refresh_models(profile)
