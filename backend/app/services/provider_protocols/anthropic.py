"""Anthropic Messages payload and event mapping."""

from __future__ import annotations

from typing import Any, Dict, List

from ... import models, schemas
from .common import _split_leading_system
from .transport import ProviderRequest


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
    if not isinstance(usage, dict):
        message = payload.get("message")
        usage = message.get("usage") if isinstance(message, dict) else None
    if not isinstance(usage, dict):
        return {}

    normalized = dict(usage)
    if payload.get("type") == "message_start":
        # Anthropic emits provisional output usage before any content. A client
        # cancellation may prevent the final cumulative message_delta usage,
        # so never expose the start value as a terminal output count.
        for key in (
            "output_tokens",
            "completion_tokens",
            "reasoning_tokens",
            "output_tokens_details",
            "completion_tokens_details",
        ):
            normalized.pop(key, None)
    return normalized

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

def prepare_request(
    profile: models.APIProfile,
    context: schemas.ContextPreviewOut,
    params: Dict[str, Any],
    key: str,
) -> ProviderRequest:
    anthropic_version = str(params.pop("anthropic_version", "2023-06-01"))
    system, _ = _split_leading_system(context)
    return ProviderRequest(
        headers={
            "x-api-key": key,
            "anthropic-version": anthropic_version,
            "content-type": "application/json",
        },
        payload={
            **params,
            "model": profile.model,
            "system": system,
            "messages": _anthropic_messages(context),
            "stream": True,
        },
        text_extractor=extract_anthropic_delta,
        thinking_extractor=extract_anthropic_thinking_delta,
        usage_extractor=extract_anthropic_usage,
    )
