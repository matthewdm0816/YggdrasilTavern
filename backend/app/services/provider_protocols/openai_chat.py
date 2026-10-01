"""OpenAI Chat Completions payload and event mapping."""

from __future__ import annotations

from typing import Any, Dict, List

from ... import models, schemas
from .common import _ordered_prompt_messages
from .transport import ProviderRequest


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

def _openai_messages(context: schemas.ContextPreviewOut) -> List[Dict[str, str]]:
    return _ordered_prompt_messages(context)


def prepare_request(
    profile: models.APIProfile,
    context: schemas.ContextPreviewOut,
    params: Dict[str, Any],
    key: str,
) -> ProviderRequest:
    payload = {**params, "model": profile.model, "messages": _openai_messages(context), "stream": True}
    payload.setdefault("stream_options", {"include_usage": True})
    return ProviderRequest(
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
        payload=payload,
        text_extractor=extract_openai_chat_delta,
        thinking_extractor=extract_openai_chat_thinking_delta,
    )
