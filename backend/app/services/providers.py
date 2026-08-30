from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List, Optional

import httpx
from fastapi import HTTPException

from .. import models, schemas


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


@dataclass
class ProviderStreamEvent:
    kind: str
    delta: str = ""
    usage: Dict[str, Any] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)


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
        raise HTTPException(status_code=400, detail="此 API Profile 尚未配置 API Key")
    return key


def _safe_provider_error(status_code: int, *, discovering_models: bool = False) -> str:
    if status_code == 401:
        return "API Key 无效或已失效，请在 API Profile 中重新填写"
    if status_code == 403:
        return "API Key 没有访问该服务或模型的权限"
    if status_code == 404 and discovering_models:
        return "该服务可能不支持远端模型列表；仍可手动填写模型名称"
    if status_code == 404:
        return "接口路径不存在，请检查 Base URL、API 协议和自定义请求路径"
    if status_code == 429:
        return "请求过于频繁或额度不足，请稍后重试并检查账户额度"
    return f"远端服务返回 HTTP {status_code}"


async def refresh_models(profile: models.APIProfile) -> List[str]:
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
        raise HTTPException(status_code=400, detail=f"Unsupported provider type: {profile.provider_type}")

    url = models_endpoint_for(profile)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"无法连接接口地址，请检查 Base URL：{exc}") from exc

    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=_safe_provider_error(response.status_code, discovering_models=True),
        )
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Remote model discovery returned invalid JSON") from exc

    raw_models: Any = payload.get("data") if isinstance(payload, dict) else None
    if raw_models is None and isinstance(payload, dict):
        raw_models = payload.get("models")
    if not isinstance(raw_models, list):
        raise HTTPException(status_code=502, detail="Remote model discovery response has no model list")

    discovered: List[str] = []
    seen: set[str] = set()
    for item in raw_models:
        if isinstance(item, str):
            model_id = item
        elif isinstance(item, dict):
            model_id = str(item.get("id") or item.get("name") or "")
        else:
            continue
        model_id = model_id.strip()
        if model_id and model_id not in seen:
            discovered.append(model_id)
            seen.add(model_id)
    return discovered


def extract_anthropic_delta(payload: Dict[str, Any]) -> str:
    if payload.get("type") != "content_block_delta":
        return ""
    delta = payload.get("delta") or {}
    if delta.get("type") == "text_delta":
        return str(delta.get("text") or "")
    return ""


def extract_anthropic_thinking_delta(payload: Dict[str, Any]) -> str:
    if payload.get("type") != "content_block_delta":
        return ""
    delta = payload.get("delta") or {}
    if delta.get("type") == "thinking_delta":
        return str(delta.get("thinking") or "")
    return ""


def extract_anthropic_usage(payload: Dict[str, Any]) -> Dict[str, Any]:
    usage = payload.get("usage")
    if isinstance(usage, dict):
        return usage
    message = payload.get("message")
    if isinstance(message, dict) and isinstance(message.get("usage"), dict):
        return message["usage"]
    return {}


def extract_openai_chat_delta(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    return str(delta.get("content") or "")


def extract_openai_chat_thinking_delta(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    delta = choices[0].get("delta") or {}
    for key in ("reasoning_content", "reasoning", "thinking"):
        value = delta.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def extract_openai_responses_delta(payload: Dict[str, Any]) -> str:
    if payload.get("type") == "response.output_text.delta":
        return str(payload.get("delta") or "")
    return ""


def extract_openai_responses_thinking_delta(payload: Dict[str, Any]) -> str:
    event_type = str(payload.get("type") or "")
    if "reasoning" not in event_type and "thinking" not in event_type:
        return ""
    for key in ("delta", "text", "summary_text"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def extract_usage(payload: Dict[str, Any]) -> Dict[str, Any]:
    usage = payload.get("usage")
    if isinstance(usage, dict):
        return usage
    response = payload.get("response")
    if isinstance(response, dict) and isinstance(response.get("usage"), dict):
        return response["usage"]
    return {}


def _stream_terminal_state(payload: Dict[str, Any]) -> tuple[bool, Optional[str]]:
    event_type = str(payload.get("type") or "")
    if event_type in {"message_stop", "response.completed", "response.done"}:
        return True, None
    if event_type in {"error", "response.failed", "response.incomplete"}:
        error = payload.get("error") or payload.get("response") or payload
        return True, f"Provider stream reported {event_type}: {error}"
    choices = payload.get("choices")
    if isinstance(choices, list) and any(
        isinstance(choice, dict) and choice.get("finish_reason") is not None for choice in choices
    ):
        return True, None
    return False, None


async def _stream_sse(
    *,
    url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    text_extractor,
    thinking_extractor,
    usage_extractor=extract_usage,
) -> AsyncIterator[ProviderStreamEvent]:
    timeout = httpx.Timeout(connect=30.0, read=None, write=30.0, pool=30.0)
    saw_terminal = False
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code >= 400:
                await response.aread()
                raise HTTPException(
                    status_code=response.status_code,
                    detail=_safe_provider_error(response.status_code),
                )
            async for line in response.aiter_lines():
                if not line or line.startswith(":") or line.startswith("event:"):
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    if data == "[DONE]":
                        saw_terminal = True
                        break
                    continue
                try:
                    parsed = json.loads(data)
                except json.JSONDecodeError as exc:
                    raise RuntimeError(f"Provider returned invalid SSE JSON: {data[:200]}") from exc
                terminal, terminal_error = _stream_terminal_state(parsed)
                if terminal_error:
                    raise RuntimeError(terminal_error)
                saw_terminal = saw_terminal or terminal
                thinking_delta = thinking_extractor(parsed)
                if thinking_delta:
                    yield ProviderStreamEvent(kind="thinking", delta=thinking_delta, raw=parsed)
                text_delta = text_extractor(parsed)
                if text_delta:
                    yield ProviderStreamEvent(kind="text", delta=text_delta, raw=parsed)
                usage = usage_extractor(parsed)
                if usage:
                    yield ProviderStreamEvent(kind="usage", usage=usage, raw=parsed)
    if not saw_terminal:
        raise RuntimeError("Provider stream ended before a completion marker")


def _ordered_prompt_messages(context: schemas.ContextPreviewOut) -> List[Dict[str, str]]:
    if context.compiled_blocks:
        return [
            {"role": block.role, "content": block.content}
            for block in context.compiled_blocks
            if block.content.strip()
        ]
    messages = [{"role": "system", "content": context.system}] if context.system else []
    messages.extend({"role": message.role, "content": message.content} for message in context.messages)
    return messages


def _openai_messages(context: schemas.ContextPreviewOut) -> List[Dict[str, str]]:
    return _ordered_prompt_messages(context)


def _split_leading_system(context: schemas.ContextPreviewOut) -> tuple[str, List[Dict[str, str]]]:
    leading: List[str] = []
    remaining: List[Dict[str, str]] = []
    in_prefix = True
    for message in _ordered_prompt_messages(context):
        if in_prefix and message["role"] == "system":
            leading.append(message["content"])
            continue
        in_prefix = False
        remaining.append(message)
    return "\n\n".join(leading), remaining


def _anthropic_messages(context: schemas.ContextPreviewOut) -> List[Dict[str, str]]:
    _, ordered = _split_leading_system(context)
    messages: List[Dict[str, str]] = []
    seen_user = False
    for raw in ordered:
        role = raw["role"]
        content = raw["content"]
        if role == "system":
            # Anthropic only permits top-level system content. Preserve a post-history
            # system slot's order by representing it as a user instruction.
            role = "user"
            content = f"[System instruction]\n{content}"
        if role not in {"user", "assistant"}:
            continue
        if role == "user":
            seen_user = True
        if role == "assistant" and not seen_user:
            messages.append({"role": "user", "content": "The scene begins. Continue naturally."})
            seen_user = True
        if messages and messages[-1]["role"] == role:
            messages[-1]["content"] += "\n\n" + content
        else:
            messages.append({"role": role, "content": content})
    if not messages:
        messages.append({"role": "user", "content": "Begin the roleplay."})
    return messages


async def stream_completion(profile: models.APIProfile, context: schemas.ContextPreviewOut) -> AsyncIterator[ProviderStreamEvent]:
    params = dict(profile.default_params or {})
    url = endpoint_for(profile)
    key = _api_key(profile)

    if profile.provider_type == "anthropic_messages":
        anthropic_version = str(params.pop("anthropic_version", "2023-06-01"))
        anthropic_system, _ = _split_leading_system(context)
        payload = {
            **params,
            "model": profile.model,
            "system": anthropic_system,
            "messages": _anthropic_messages(context),
            "stream": True,
        }
        payload.setdefault("max_tokens", 1024)
        headers = {
            "x-api-key": key,
            "anthropic-version": anthropic_version,
            "content-type": "application/json",
        }
        async for event in _stream_sse(
            url=url,
            headers=headers,
            payload=payload,
            text_extractor=extract_anthropic_delta,
            thinking_extractor=extract_anthropic_thinking_delta,
            usage_extractor=extract_anthropic_usage,
        ):
            yield event
        return

    if profile.provider_type == "openai_chat_completions":
        payload = {**params, "model": profile.model, "messages": _openai_messages(context), "stream": True}
        payload.setdefault("stream_options", {"include_usage": True})
        headers = {"Authorization": f"Bearer {key}", "content-type": "application/json"}
        async for event in _stream_sse(
            url=url,
            headers=headers,
            payload=payload,
            text_extractor=extract_openai_chat_delta,
            thinking_extractor=extract_openai_chat_thinking_delta,
        ):
            yield event
        return

    if profile.provider_type == "openai_responses":
        instructions, response_input = _split_leading_system(context)
        payload = {
            **params,
            "model": profile.model,
            "instructions": instructions,
            "input": response_input,
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {key}", "content-type": "application/json"}
        async for event in _stream_sse(
            url=url,
            headers=headers,
            payload=payload,
            text_extractor=extract_openai_responses_delta,
            thinking_extractor=extract_openai_responses_thinking_delta,
        ):
            yield event
        return

    raise HTTPException(status_code=400, detail=f"Unsupported provider type: {profile.provider_type}")
