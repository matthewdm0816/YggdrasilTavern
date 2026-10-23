"""Validation and merging for per-profile request customizations."""

from __future__ import annotations

import json
import re
from typing import Any, Mapping


_HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
AUTH_HEADER_NAMES = frozenset({"authorization", "x-api-key", "api-key"})


def validate_body_params(params: dict[str, Any] | None) -> None:
    message = "自定义正文参数必须是 JSON 对象，数字不能为 NaN 或 Infinity"
    if not isinstance(params, dict):
        raise ValueError(message)
    try:
        json.dumps(params, allow_nan=False)
    except (TypeError, ValueError, OverflowError):
        # JSON errors must not echo submitted body or header credentials.
        raise ValueError(message) from None


def normalize_custom_headers(headers: Mapping[str, str | None], *, allow_deletions: bool = False) -> dict[str, str | None]:
    normalized: dict[str, str | None] = {}
    for name, value in headers.items():
        if not isinstance(name, str) or not _HEADER_NAME.fullmatch(name):
            raise ValueError("自定义请求头名称必须是有效的 HTTP header 名称")
        if value is None:
            if not allow_deletions:
                raise ValueError("新建自定义请求头必须填写值")
        elif (not isinstance(value, str) or not value.strip()
              or any(ord(char) < 32 or ord(char) > 126 for char in value)):
            raise ValueError("自定义请求头值必须是非空 ASCII 文本，且不能包含换行或控制字符")
        else:
            value = value.strip()
        previous = next((key for key in normalized if key.lower() == name.lower()), None)
        if previous is not None:
            del normalized[previous]
        normalized[name] = value
    return normalized


def patch_custom_headers(current: Mapping[str, str] | None, patch: Mapping[str, str | None]) -> dict[str, str]:
    merged = dict(current or {})
    for name, value in normalize_custom_headers(patch, allow_deletions=True).items():
        for previous in list(merged):
            if previous.lower() == name.lower():
                del merged[previous]
        if value is not None:
            merged[name] = value
    return merged


def merge_request_headers(builtin: Mapping[str, str], custom: Mapping[str, str] | None) -> dict[str, str]:
    return patch_custom_headers(builtin, custom or {})


def has_custom_auth(headers: Mapping[str, str | None] | None) -> bool:
    return any(name.lower() in AUTH_HEADER_NAMES and bool(value and value.strip()) for name, value in (headers or {}).items())


def headers_need_replacement(current: Mapping[str, str] | None, patch: Mapping[str, str | None]) -> bool:
    supplied = {name.lower() for name in patch}
    return any(name.lower() not in supplied for name in (current or {}))


def normalize_excluded_body_params(fields: list[str]) -> list[str]:
    result: list[str] = []
    for name in fields:
        if not isinstance(name, str) or not name.strip():
            raise ValueError("要排除的正文参数必须是非空字段名")
        name = name.strip()
        if name not in result:
            result.append(name)
    return result
