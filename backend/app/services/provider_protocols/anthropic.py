"""Anthropic Messages payload and event mapping."""

from __future__ import annotations

from copy import deepcopy
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
    raw_input = normalized.get("input_tokens")
    if isinstance(raw_input, int) and not isinstance(raw_input, bool) and raw_input >= 0:
        normalized["uncached_input_tokens"] = raw_input
        normalized["input_tokens"] = raw_input + sum(
            value for name in ("cache_read_input_tokens", "cache_creation_input_tokens")
            if isinstance(value := normalized.get(name), int) and not isinstance(value, bool) and value >= 0
        )
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
    messages, _ = _message_blocks(context)
    # Joining a turn's blocks reproduces the plain "\n\n"-joined content.
    return [{"role": message["role"], "content": "".join(block["text"] for block in message["content"])} for message in messages]


def _message_blocks(context: schemas.ContextPreviewOut) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
    """Build Anthropic turns as text blocks and return the last history block for cache breakpoints."""
    _, ordered = _split_leading_system(context)
    if context.compiled_blocks:
        history = [block.is_history for block in context.compiled_blocks if block.content.strip()]
        history = history[-len(ordered):] if ordered else []
    else:
        history = [message["role"] in {"user", "assistant"} for message in ordered]
    messages: list[dict[str, Any]] = []
    last_history = None
    seen_user = False
    for raw, is_history in zip(ordered, history, strict=True):
        role, content = raw["role"], raw["content"]
        if role == "system":
            # Anthropic only permits top-level system content. Preserve a post-history
            # system slot's order by representing it as a user instruction.
            role, content = "user", f"[System instruction]\n{content}"
        if role not in {"user", "assistant"}:
            continue
        if role == "user":
            seen_user = True
        if role == "assistant" and not seen_user:
            messages.append({"role": "user", "content": [{"type": "text", "text": "The scene begins. Continue naturally."}]})
            seen_user = True
        continuing = bool(messages and messages[-1]["role"] == role)
        block: dict[str, Any] = {"type": "text", "text": ("\n\n" if continuing else "") + content}
        if continuing:
            messages[-1]["content"].append(block)
        else:
            messages.append({"role": role, "content": [block]})
        if is_history and content.strip():
            last_history = block
    if not messages:
        messages.append({"role": "user", "content": [{"type": "text", "text": "Begin the roleplay."}]})
    return messages, last_history


def _apply_prompt_cache(payload: Dict[str, Any], context: schemas.ContextPreviewOut) -> None:
    messages, last_history = _message_blocks(context)
    payload["messages"] = messages
    system = payload["system"]
    payload["system"] = [{"type": "text", "text": system}] if system.strip() else []
    existing = int("cache_control" in payload)
    existing += sum("cache_control" in tool for tool in payload.get("tools", []) if isinstance(tool, dict))
    if existing > 4:
        raise ValueError("Anthropic 提示词缓存最多允许 4 个缓存断点")
    targets = [*payload["system"][-1:], *([last_history] if last_history is not None else [])]
    for block in targets[:4 - existing]:
        block["cache_control"] = {"type": "ephemeral"}


def prepare_request(
    profile: models.APIProfile,
    context: schemas.ContextPreviewOut,
    params: Dict[str, Any],
    key: str,
) -> ProviderRequest:
    params = deepcopy(params)
    anthropic_version = str(params.pop("anthropic_version", "2023-06-01"))
    system, _ = _split_leading_system(context)
    payload = {
        **params, "model": profile.model, "system": system,
        "messages": _anthropic_messages(context), "stream": True,
    }
    if profile.anthropic_prompt_cache:
        _apply_prompt_cache(payload, context)
    return ProviderRequest(
        headers={
            **({"x-api-key": key} if key else {}),
            "anthropic-version": anthropic_version,
            "content-type": "application/json",
        },
        payload=payload,
        text_extractor=extract_anthropic_delta,
        thinking_extractor=extract_anthropic_thinking_delta,
        usage_extractor=extract_anthropic_usage,
    )
