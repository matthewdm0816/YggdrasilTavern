"""OpenAI Responses payload and event mapping."""

from __future__ import annotations

from typing import Any, Dict

from ... import models, schemas
from .common import _split_leading_system
from .transport import ProviderRequest


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

def prepare_request(
    profile: models.APIProfile,
    context: schemas.ContextPreviewOut,
    params: Dict[str, Any],
    key: str,
) -> ProviderRequest:
    instructions, response_input = _split_leading_system(context)
    return ProviderRequest(
        headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
        payload={
            **params,
            "model": profile.model,
            "instructions": instructions,
            "input": response_input,
            "stream": True,
        },
        text_extractor=extract_openai_responses_delta,
        thinking_extractor=extract_openai_responses_thinking_delta,
    )
