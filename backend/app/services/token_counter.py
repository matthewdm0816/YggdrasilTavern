from __future__ import annotations

import math
import re
from typing import Any, Dict


def count_text_tokens(text: str, model: str | None = None) -> int:
    if not text:
        return 0
    try:
        import tiktoken  # type: ignore

        try:
            encoding = tiktoken.encoding_for_model(model or "")
        except Exception:
            encoding = tiktoken.get_encoding("cl100k_base")
        return len(encoding.encode(text))
    except Exception:
        cjk = len(re.findall(r"[\u3400-\u9fff]", text))
        rest = len(text) - cjk
        return cjk + math.ceil(rest / 4)


def merge_usage(current: Dict[str, Any], update: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(current or {})
    for key, value in (update or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_usage(merged[key], value)
        else:
            merged[key] = value
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


def reasoning_tokens_from_usage(usage: Dict[str, Any]) -> int:
    if not usage:
        return 0
    candidates = [
        usage.get("reasoning_tokens"),
        usage.get("completion_tokens_details", {}).get("reasoning_tokens") if isinstance(usage.get("completion_tokens_details"), dict) else None,
        usage.get("output_tokens_details", {}).get("reasoning_tokens") if isinstance(usage.get("output_tokens_details"), dict) else None,
    ]
    return _first_non_negative_int(*candidates) or 0
