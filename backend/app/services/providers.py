"""Provider facade: profile configuration, discovery, and adapter dispatch.

Public imports remain here for API callers and existing integrations.
"""

from __future__ import annotations

import os
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx

from .. import models, schemas
from .errors import ApplicationError
from .provider_protocols import anthropic, openai_chat, openai_responses
from .provider_protocols.anthropic import (
    _anthropic_messages,
    extract_anthropic_delta,
    extract_anthropic_thinking_delta,
    extract_anthropic_usage,
)
from .provider_protocols.common import _ordered_prompt_messages, _split_leading_system
from .provider_protocols.openai_chat import (
    _openai_messages,
    extract_openai_chat_delta,
    extract_openai_chat_thinking_delta,
)
from .provider_protocols.openai_responses import (
    extract_openai_responses_delta,
    extract_openai_responses_thinking_delta,
)
from .provider_protocols.transport import (
    ProviderStreamEvent,
    _safe_provider_error,
    _stream_sse,
    _stream_terminal_state,
    extract_usage,
    provider_error_detail,
    safe_endpoint,
    safe_error_text,
)
from .token_limits import apply_provider_output_limit, resolve_profile_token_limits


DEFAULT_BASE_URLS = {
    "anthropic_messages": "https://api.anthropic.com",
    "openai_chat_completions": "https://api.openai.com",
    "openai_responses": "https://api.openai.com",
}

DEFAULT_PATHS = {
    "anthropic_messages": "/v1/messages",
    "openai_chat_completions": "/v1/chat/completions",
    "openai_responses": "/v1/responses",
}

THINKING_LEVEL_PARAM = "_thinking_level"
THINKING_LEVELS = {"auto", "off", "low", "medium", "high", "xhigh", "max"}

def endpoint_for(profile: models.APIProfile) -> str:
    base = (profile.base_url or DEFAULT_BASE_URLS[profile.provider_type]).rstrip("/")
    path = profile.path_override or DEFAULT_PATHS[profile.provider_type]
    if path.startswith("http://") or path.startswith("https://"):
        return path
    # Most compatible APIs document their Base URL as ending in /v1.  Avoid
    # producing /v1/v1/... when the default completion path also starts there.
    if not profile.path_override and base.endswith("/v1") and path.startswith("/v1/"):
        path = path[3:]
    return base + "/" + path.lstrip("/")


def models_endpoint_for(profile: models.APIProfile) -> str:
    """Build the discovery endpoint without reusing a completion path override."""

    base = (profile.base_url or DEFAULT_BASE_URLS[profile.provider_type]).rstrip("/")
    if base.endswith("/v1/models"):
        return base
    if base.endswith("/v1"):
        return base + "/models"
    return base + "/v1/models"


def _api_key(profile: models.APIProfile) -> str:
    key = (profile.api_key or "").strip()
    if not key and profile.api_key_env:
        key = (os.getenv(profile.api_key_env) or "").strip()
    if not key:
        raise ApplicationError(status_code=400, detail="此 API Profile 尚未配置 API Key")
    return key

def apply_thinking_level(provider_type: str, params: Dict[str, Any]) -> Dict[str, Any]:
    """Translate the UI's provider-neutral thinking level into API parameters.

    ``_thinking_level`` is an application-only setting stored with the profile.
    It must never leak into a provider payload.  Model support differs, so this
    function only translates protocol shapes and deliberately leaves an
    unsupported level for the remote API to reject with its useful error.
    """

    translated = dict(params)
    raw_level = translated.pop(THINKING_LEVEL_PARAM, "auto")
    level = "auto" if raw_level is None else str(raw_level).strip().lower()
    if level not in THINKING_LEVELS:
        raise ApplicationError(status_code=400, detail=f"未知的 Thinking Level：{raw_level}")
    if level == "auto":
        return translated

    if provider_type == "openai_responses":
        reasoning = translated.get("reasoning")
        if reasoning is not None and not isinstance(reasoning, dict):
            raise ApplicationError(status_code=400, detail="default_params.reasoning 必须是对象")
        translated["reasoning"] = {**(reasoning or {}), "effort": "none" if level == "off" else level}
        return translated

    if provider_type == "openai_chat_completions":
        translated["reasoning_effort"] = "none" if level == "off" else level
        return translated

    if provider_type == "anthropic_messages":
        if level == "off":
            translated["thinking"] = {"type": "disabled"}
            output_config = translated.get("output_config")
            if output_config is not None and not isinstance(output_config, dict):
                raise ApplicationError(status_code=400, detail="default_params.output_config 必须是对象")
            if isinstance(output_config, dict) and "effort" in output_config:
                output_config = dict(output_config)
                output_config.pop("effort", None)
                if output_config:
                    translated["output_config"] = output_config
                else:
                    translated.pop("output_config", None)
            return translated

        temperature = translated.get("temperature")
        if temperature is not None and temperature != 1:
            raise ApplicationError(
                status_code=400,
                detail="Anthropic 开启思考时 Temperature 必须留空或设为 1",
            )
        output_config = translated.get("output_config")
        if output_config is not None and not isinstance(output_config, dict):
            raise ApplicationError(status_code=400, detail="default_params.output_config 必须是对象")
        translated["thinking"] = {"type": "adaptive"}
        translated["output_config"] = {**(output_config or {}), "effort": level}
        return translated

    raise ApplicationError(status_code=400, detail=f"Unsupported provider type: {provider_type}")


def _optional_positive_int(value: Any) -> Optional[int]:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return None


def _capability_supported(raw: Any) -> Optional[bool]:
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, dict) and isinstance(raw.get("supported"), bool):
        return raw["supported"]
    return None


def normalize_remote_model(item: Any, provider_type: str) -> Optional[schemas.RemoteModelInfo]:
    if isinstance(item, str):
        model_id = item.strip()
        return schemas.RemoteModelInfo(id=model_id) if model_id else None
    if not isinstance(item, dict):
        return None
    model_id = str(item.get("id") or item.get("name") or "").strip()
    if not model_id or len(model_id) > 200:
        return None

    max_input = _optional_positive_int(item.get("max_input_tokens")) or _optional_positive_int(
        item.get("input_token_limit")
    )
    max_total = None
    for key in ("context_length", "context_window", "max_context_length", "max_model_len"):
        max_total = _optional_positive_int(item.get(key))
        if max_total:
            break
    max_output = None
    for key in ("max_output_tokens", "max_completion_tokens", "output_token_limit"):
        max_output = _optional_positive_int(item.get(key))
        if max_output:
            break
    if provider_type == "anthropic_messages" and max_output is None:
        max_output = _optional_positive_int(item.get("max_tokens"))

    capabilities = item.get("capabilities") if isinstance(item.get("capabilities"), dict) else {}
    supports_reasoning = _capability_supported(item.get("supports_reasoning"))
    if supports_reasoning is None:
        supports_reasoning = _capability_supported(capabilities.get("reasoning"))
    if supports_reasoning is None:
        supports_reasoning = _capability_supported(capabilities.get("thinking"))
    supports_vision = _capability_supported(item.get("supports_image_in"))
    if supports_vision is None:
        supports_vision = _capability_supported(capabilities.get("image_input"))

    display_name = item.get("display_name")
    return schemas.RemoteModelInfo(
        id=model_id,
        display_name=str(display_name).strip() if display_name else None,
        max_input_tokens=max_input,
        max_output_tokens=max_output,
        max_total_tokens=max_total,
        supports_reasoning=supports_reasoning,
        supports_vision=supports_vision,
    )


async def refresh_models(profile: models.APIProfile) -> List[schemas.RemoteModelInfo]:
    key = _api_key(profile)
    params = dict(profile.default_params or {})
    if profile.provider_type == "anthropic_messages":
        headers = {
            "x-api-key": key,
            "anthropic-version": str(params.get("anthropic_version", "2023-06-01")),
        }
    elif profile.provider_type in {"openai_chat_completions", "openai_responses"}:
        headers = {"Authorization": f"Bearer {key}"}
    else:
        raise ApplicationError(status_code=400, detail=f"Unsupported provider type: {profile.provider_type}")

    url = models_endpoint_for(profile)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            query = {"limit": 1000} if profile.provider_type == "anthropic_messages" else None
            response = await client.get(url, headers=headers, params=query)
    except httpx.HTTPError as exc:
        raise ApplicationError(status_code=502, detail=f"无法连接模型列表接口：{safe_endpoint(url)}；{safe_error_text(exc, headers)}") from exc

    if response.status_code >= 400:
        raise ApplicationError(
            status_code=502,
            detail=provider_error_detail(response, url=url, headers=headers, discovering_models=True),
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise ApplicationError(status_code=502, detail="模型列表接口返回的内容不是有效 JSON") from exc

    raw_models: Any = payload.get("data") if isinstance(payload, dict) else None
    if raw_models is None and isinstance(payload, dict):
        raw_models = payload.get("models")
    if not isinstance(raw_models, list):
        raise ApplicationError(status_code=502, detail="该接口未返回模型列表，可能不支持获取模型列表")

    discovered: List[schemas.RemoteModelInfo] = []
    seen: set[str] = set()
    for item in raw_models[:1000]:
        normalized = normalize_remote_model(item, profile.provider_type)
        if normalized and normalized.id not in seen:
            discovered.append(normalized)
            seen.add(normalized.id)
    return discovered

async def stream_completion(
    profile: models.APIProfile,
    context: schemas.ContextPreviewOut,
) -> AsyncIterator[ProviderStreamEvent]:
    limits = resolve_profile_token_limits(profile)
    params = apply_thinking_level(profile.provider_type, dict(profile.default_params or {}))
    params = apply_provider_output_limit(profile.provider_type, params, limits)
    url = endpoint_for(profile)
    key = _api_key(profile)

    adapters = {
        "anthropic_messages": anthropic.prepare_request,
        "openai_chat_completions": openai_chat.prepare_request,
        "openai_responses": openai_responses.prepare_request,
    }
    prepare_request = adapters.get(profile.provider_type)
    if prepare_request is None:
        raise ApplicationError(status_code=400, detail=f"Unsupported provider type: {profile.provider_type}")
    request = prepare_request(profile, context, params, key)
    try:
        async for event in _stream_sse(
            url=url,
            headers=request.headers,
            payload=request.payload,
            text_extractor=request.text_extractor,
            thinking_extractor=request.thinking_extractor,
            usage_extractor=request.usage_extractor,
        ):
            yield event
    except httpx.HTTPError as exc:
        raise ApplicationError(status_code=502, detail=f"生成回复时连接失败，请检查网络和服务地址。\n模型：{profile.model}\n请求地址：{safe_endpoint(url)}\n原因：{safe_error_text(exc, request.headers)}") from exc
