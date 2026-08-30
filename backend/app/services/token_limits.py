from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from .. import models


DEFAULT_INPUT_TOKEN_LIMIT = 256 * 1024
DEFAULT_OUTPUT_TOKEN_LIMIT = 32 * 1024


def _positive_int(value: Any) -> Optional[int]:
    if isinstance(value, int) and not isinstance(value, bool) and value > 0:
        return value
    return None


@dataclass(frozen=True)
class ResolvedTokenLimits:
    configured_input_tokens: int
    configured_output_tokens: int
    effective_input_tokens: int
    effective_output_tokens: int
    model_max_input_tokens: Optional[int] = None
    model_max_output_tokens: Optional[int] = None
    model_max_total_tokens: Optional[int] = None


def default_token_limits() -> ResolvedTokenLimits:
    return ResolvedTokenLimits(
        configured_input_tokens=DEFAULT_INPUT_TOKEN_LIMIT,
        configured_output_tokens=DEFAULT_OUTPUT_TOKEN_LIMIT,
        effective_input_tokens=DEFAULT_INPUT_TOKEN_LIMIT,
        effective_output_tokens=DEFAULT_OUTPUT_TOKEN_LIMIT,
    )


def selected_model_metadata(profile: models.APIProfile) -> Dict[str, Any]:
    for item in profile.model_catalog or []:
        if isinstance(item, dict) and str(item.get("id") or "") == profile.model:
            return item
    return {}


def resolve_profile_token_limits(profile: models.APIProfile) -> ResolvedTokenLimits:
    configured_input = _positive_int(profile.input_token_limit) or DEFAULT_INPUT_TOKEN_LIMIT
    configured_output = _positive_int(profile.output_token_limit) or DEFAULT_OUTPUT_TOKEN_LIMIT
    metadata = selected_model_metadata(profile)
    model_max_input = _positive_int(metadata.get("max_input_tokens"))
    model_max_output = _positive_int(metadata.get("max_output_tokens"))
    model_max_total = _positive_int(metadata.get("max_total_tokens"))

    effective_output = min(configured_output, model_max_output) if model_max_output else configured_output
    effective_input = min(configured_input, model_max_input) if model_max_input else configured_input
    if model_max_total:
        available_input = model_max_total - effective_output
        if available_input < 1:
            raise ValueError(
                f"输出上限 {effective_output} 已占满模型总上下文 {model_max_total}；请调低输出 Token 上限"
            )
        effective_input = min(effective_input, available_input)

    return ResolvedTokenLimits(
        configured_input_tokens=configured_input,
        configured_output_tokens=configured_output,
        effective_input_tokens=effective_input,
        effective_output_tokens=effective_output,
        model_max_input_tokens=model_max_input,
        model_max_output_tokens=model_max_output,
        model_max_total_tokens=model_max_total,
    )


def apply_provider_output_limit(
    provider_type: str,
    params: Dict[str, Any],
    limits: ResolvedTokenLimits,
) -> Dict[str, Any]:
    translated = dict(params)
    output_limit = limits.effective_output_tokens

    if provider_type == "openai_responses":
        translated.pop("max_tokens", None)
        translated.pop("max_completion_tokens", None)
        translated["max_output_tokens"] = output_limit
        return translated

    if provider_type == "openai_chat_completions":
        translated.pop("max_output_tokens", None)
        if "max_tokens" in translated and "max_completion_tokens" not in translated:
            translated["max_tokens"] = output_limit
        else:
            translated.pop("max_tokens", None)
            translated["max_completion_tokens"] = output_limit
        return translated

    if provider_type == "anthropic_messages":
        translated.pop("max_output_tokens", None)
        translated.pop("max_completion_tokens", None)
        translated["max_tokens"] = output_limit
        return translated

    raise ValueError(f"Unsupported provider type: {provider_type}")
