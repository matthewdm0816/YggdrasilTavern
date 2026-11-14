from __future__ import annotations

import functools
import logging
import math
import re
from typing import Any, Dict

logger = logging.getLogger(__name__)


def _heuristic_token_count(text: str) -> int:
    cjk = len(re.findall(r"[\u3400-\u9fff]", text))
    rest = len(text) - cjk
    return cjk + math.ceil(rest / 4)


@functools.lru_cache(maxsize=32)
def _get_encoding(model: str) -> Any:
    try:
        import tiktoken  # type: ignore
    except Exception as exc:
        logger.warning("Failed to import tiktoken; falling back to heuristic token counter: %s", exc)
        return None

    if model:
        try:
            return tiktoken.encoding_for_model(model)
        except KeyError:
            pass
        except Exception as exc:
            logger.warning(
                "Unexpected error resolving tiktoken encoding for model %r; falling back to cl100k_base: %s",
                model,
                exc,
            )
    try:
        return tiktoken.get_encoding("cl100k_base")
    except Exception as exc:
        logger.warning("Failed to initialize cl100k_base tiktoken encoding; falling back to heuristic counter: %s", exc)
        return None


def count_text_tokens(text: str, model: str | None = None) -> int:
    if not text:
        return 0
    encoding = _get_encoding(model or "")
    if encoding is None:
        return _heuristic_token_count(text)
    try:
        return len(encoding.encode(text, disallowed_special=()))
    except Exception as exc:
        logger.warning("Unexpected error encoding text with tiktoken; falling back to heuristic counter: %s", exc)
        return _heuristic_token_count(text)


def merge_usage(current: Dict[str, Any], update: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(current or {})
    for key, value in (update or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_usage(merged[key], value)
        else:
            merged[key] = value
    if isinstance(merged.get("uncached_input_tokens"), int) and not isinstance(merged["uncached_input_tokens"], bool):
        # Anthropic reports uncached input, cache reads, and cache writes separately.
        # Recompute after merging so partial stream usage cannot erase prior counts.
        merged["input_tokens"] = sum(
            value for key in ("uncached_input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
            if isinstance(value := merged.get(key), int) and not isinstance(value, bool) and value >= 0
        )
    return merged


def _first_non_negative_int(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
            return value
    return None


def input_tokens_from_usage(usage: Dict[str, Any]) -> int | None:
    if not usage:
        return None
    return _first_non_negative_int(
        usage.get("input_tokens"),
        usage.get("prompt_tokens"),
    )


def output_tokens_from_usage(usage: Dict[str, Any]) -> int | None:
    if not usage:
        return None
    return _first_non_negative_int(
        usage.get("output_tokens"),
        usage.get("completion_tokens"),
    )


def cached_tokens_from_usage(usage: Dict[str, Any]) -> int:
    if not usage:
        return 0
    candidates = [
        usage.get("cached_tokens"),
        usage.get("prompt_tokens_details", {}).get("cached_tokens") if isinstance(usage.get("prompt_tokens_details"), dict) else None,
        usage.get("input_tokens_details", {}).get("cached_tokens") if isinstance(usage.get("input_tokens_details"), dict) else None,
        usage.get("cache_read_input_tokens"),
    ]
    return _first_non_negative_int(*candidates) or 0


def optional_reasoning_tokens_from_usage(usage: Dict[str, Any]) -> int | None:
    if not usage:
        return None
    candidates = [
        usage.get("reasoning_tokens"),
        usage.get("completion_tokens_details", {}).get("reasoning_tokens") if isinstance(usage.get("completion_tokens_details"), dict) else None,
        usage.get("output_tokens_details", {}).get("reasoning_tokens") if isinstance(usage.get("output_tokens_details"), dict) else None,
    ]
    return _first_non_negative_int(*candidates)


def reasoning_tokens_from_usage(usage: Dict[str, Any]) -> int:
    return optional_reasoning_tokens_from_usage(usage) or 0
