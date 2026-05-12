from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Dict, List

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
    return base + "/" + path.lstrip("/")


def _api_key(profile: models.APIProfile) -> str:
    key = os.getenv(profile.api_key_env)
    if not key:
        raise HTTPException(status_code=400, detail=f"Missing API key env var: {profile.api_key_env}")
    return key


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
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code >= 400:
                detail = await response.aread()
                raise HTTPException(status_code=response.status_code, detail=detail.decode("utf-8", errors="ignore"))
            async for line in response.aiter_lines():
                if not line or line.startswith(":") or line.startswith("event:"):
                    continue
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data or data == "[DONE]":
                    if data == "[DONE]":
                        break
                    continue
                try:
                    parsed = json.loads(data)
                except json.JSONDecodeError:
                    continue
                thinking_delta = thinking_extractor(parsed)
                if thinking_delta:
                    yield ProviderStreamEvent(kind="thinking", delta=thinking_delta, raw=parsed)
                text_delta = text_extractor(parsed)
                if text_delta:
                    yield ProviderStreamEvent(kind="text", delta=text_delta, raw=parsed)
                usage = usage_extractor(parsed)
                if usage:
                    yield ProviderStreamEvent(kind="usage", usage=usage, raw=parsed)


def _openai_messages(context: schemas.ContextPreviewOut) -> List[Dict[str, str]]:
    messages = [{"role": "system", "content": context.system}] if context.system else []
    messages.extend({"role": message.role, "content": message.content} for message in context.messages)
    return messages


def _anthropic_messages(context: schemas.ContextPreviewOut) -> List[Dict[str, str]]:
    messages: List[Dict[str, str]] = []
    seen_user = False
    for message in context.messages:
        if message.role not in {"user", "assistant"}:
            continue
        if message.role == "user":
            seen_user = True
        if message.role == "assistant" and not seen_user:
            messages.append({"role": "user", "content": "The scene begins. Continue naturally."})
            seen_user = True
        messages.append({"role": message.role, "content": message.content})
    if not messages:
        messages.append({"role": "user", "content": "Begin the roleplay."})
    return messages


async def stream_completion(profile: models.APIProfile, context: schemas.ContextPreviewOut) -> AsyncIterator[ProviderStreamEvent]:
    params = dict(profile.default_params or {})
    url = endpoint_for(profile)
    key = _api_key(profile)

    if profile.provider_type == "anthropic_messages":
        anthropic_version = str(params.pop("anthropic_version", "2023-06-01"))
        payload = {
            **params,
            "model": profile.model,
            "system": context.system,
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
        payload = {
            **params,
            "model": profile.model,
            "instructions": context.system,
            "input": [{"role": message.role, "content": message.content} for message in context.messages],
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
