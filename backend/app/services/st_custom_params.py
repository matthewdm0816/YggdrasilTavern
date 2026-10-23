"""Parse the explicitly supported subset of ST custom request settings.

JSON is supported in full. The text fallback accepts flat key: value lines;
it deliberately rejects YAML anchors, tags, nesting, block scalars and macros.
Diagnostics never include source values, because headers may be credentials.
"""

from __future__ import annotations

import json
import re
from typing import Any

from .provider_protocols.request_settings import normalize_custom_headers, normalize_excluded_body_params, validate_body_params


def _reject_json_constant(_value: str) -> None:
    raise ValueError("non-finite JSON number")


def _parse(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        raise ValueError("expected JSON or flat key/value text")
    if "{{" in value:
        raise ValueError("macros are unsupported")
    try:
        return json.loads(value, parse_constant=_reject_json_constant)
    except json.JSONDecodeError:
        pass
    result = {}
    for line in value.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[:1].isspace() or ":" not in line:
            raise ValueError("nested or non-mapping text")
        key, item = line.split(":", 1)
        key, item = key.strip(), item.strip()
        if not re.fullmatch(r"[A-Za-z0-9_!#$%&'*+.^`|~-]+", key) or key in result:
            raise ValueError("invalid or duplicate key")
        if not item or item.startswith(("&", "*", "!", "|", ">", "'")):
            raise ValueError("complex YAML value")
        try:
            result[key] = json.loads(item, parse_constant=_reject_json_constant)
        except json.JSONDecodeError:
            if item.startswith(("[", "{", '"')) or re.search(r"\s#|:\s", item) or item.lower() in {"yes", "no", "on", "off", "~", ".nan", ".inf", "-.inf"}:
                raise ValueError("unsupported YAML scalar")
            result[key] = item
    return result


def convert_custom_request_settings(raw: dict) -> tuple[dict, dict[str, str], list[str], list[str]]:
    body: dict = {}
    headers: dict[str, str] = {}
    excluded: list[str] = []
    warnings = []
    for option in ("custom_include_body", "custom_include_headers", "custom_exclude_body"):
        value = raw.get(option)
        if value is None or value == "" or value == {} or value == []:
            continue
        try:
            parsed = _parse(value)
            # Wrapping also lets exclusions (a list) share strict recursive JSON
            # validation with API profile writes, including overflowed numbers.
            validate_body_params({"option": parsed})
            if option == "custom_exclude_body":
                names = list(parsed) if isinstance(parsed, (dict, list)) else None
                if names is None or any(not isinstance(name, str) or not name.strip() for name in names):
                    raise ValueError("expected parameter names")
                excluded = normalize_excluded_body_params(names)
            else:
                if not isinstance(parsed, dict) or any(not isinstance(key, str) for key in parsed):
                    raise ValueError("expected object")
                if option == "custom_include_headers":
                    if any(not isinstance(item, str) for item in parsed.values()):
                        raise ValueError("header values must be strings")
                    headers = normalize_custom_headers(parsed)
                else:
                    body = parsed
        except (ValueError, TypeError):
            warnings.append(f"{option} 格式尚未支持；仅转换 JSON 或简单 key: value 行，数字必须有限，复杂 YAML 和宏未应用")
    return body, headers, excluded, warnings
