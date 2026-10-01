"""Shared HTTP SSE transport and normalized stream events."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable, Dict, Optional

import httpx

from ..errors import ApplicationError


@dataclass
class ProviderStreamEvent:
    kind: str
    delta: str = ""
    usage: Dict[str, Any] = field(default_factory=dict)
    raw: Dict[str, Any] = field(default_factory=dict)

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

def extract_usage(payload: Dict[str, Any]) -> Dict[str, Any]:
    merged: Dict[str, Any] = {}
    usage = payload.get("usage")
    if isinstance(usage, dict):
        merged.update(usage)
    response = payload.get("response")
    if isinstance(response, dict) and isinstance(response.get("usage"), dict):
        merged.update(response["usage"])
    choices = payload.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            choice_usage = choice.get("usage")
            if isinstance(choice_usage, dict):
                merged.update(choice_usage)
            delta = choice.get("delta")
            if isinstance(delta, dict) and isinstance(delta.get("usage"), dict):
                merged.update(delta["usage"])
    return merged


@dataclass(frozen=True)
class ProviderRequest:
    headers: Dict[str, str]
    payload: Dict[str, Any]
    text_extractor: Callable[[Dict[str, Any]], str]
    thinking_extractor: Callable[[Dict[str, Any]], str]
    usage_extractor: Callable[[Dict[str, Any]], Dict[str, Any]] = extract_usage

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
                raise ApplicationError(
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
