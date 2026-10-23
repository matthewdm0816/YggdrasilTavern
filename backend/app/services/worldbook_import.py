"""Shared SillyTavern worldbook/card conversion, independent of models and schemas.

ST world-info.js at 7e8663cd9c184a550b37238218bdd32c6efc68e9 uses
scanDepth / character-book extensions.scan_depth for keyword scanning. Its depth
field is an @D insertion position and is never a source for our scanning depth.
"""

from __future__ import annotations

from typing import Any, Iterable


def _read(raw: dict, *names: str, default: Any = None) -> Any:
    for source in (raw, raw.get("extensions") or {}):
        if isinstance(source, dict):
            for name in names:
                if name in source:
                    return source[name]
    return default


def _bool(value: Any, name: str, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if value in (0, 1):
        return bool(value)
    if isinstance(value, str) and value.lower() in {"true", "false"}:
        return value.lower() == "true"
    raise ValueError(f"{name} 必须是布尔值")


def _nonnegative(value: Any, name: str, default: int | None = None) -> int | None:
    if value is None:
        return default
    # ST's old delayUntilRecursion checkbox stores true/false; its level input
    # stores a number. Preserve levels rather than converting them to bool.
    if isinstance(value, bool):
        return int(value)
    try:
        number = int(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ValueError(f"{name} 必须是非负整数") from exc
    if number < 0 or (isinstance(value, float) and value != number):
        raise ValueError(f"{name} 必须是非负整数")
    return number


def _strings(value: Any) -> list[str]:
    if value is None:
        return []
    values = value if isinstance(value, list) else str(value).split(",")
    return [str(item).strip() for item in values if str(item).strip()]


def iter_worldbook_entries(raw: dict) -> Iterable[dict]:
    lorebook = raw.get("lorebook")
    entries = raw.get("entries") or raw.get("world_info") or (
        lorebook.get("entries", []) if isinstance(lorebook, dict) else []
    )
    if isinstance(entries, dict):
        for uid, entry in entries.items():
            if isinstance(entry, dict):
                yield {"uid": str(uid), **entry}
    elif isinstance(entries, list):
        yield from (entry for entry in entries if isinstance(entry, dict))


def normalize_worldbook_settings(raw: dict, *, defaults: dict | None = None) -> dict:
    defaults = defaults or {}
    return {
        "scan_depth": _nonnegative(_read(raw, "scan_depth", "scanDepth"), "scan_depth", defaults.get("scan_depth", 8)),
        "token_budget": _nonnegative(_read(raw, "token_budget", "budget"), "token_budget", defaults.get("token_budget", 4000)),
        "recursive_scanning": _bool(_read(raw, "recursive_scanning", "recursive"), "recursive_scanning", defaults.get("recursive_scanning", False)),
        "max_recursion_steps": _nonnegative(_read(raw, "max_recursion_steps", "maxRecursionSteps"), "max_recursion_steps", defaults.get("max_recursion_steps", 0)),
    }


def normalize_worldbook_entry(raw: dict, *, defaults: dict | None = None) -> tuple[dict, list[str]]:
    """Return runtime/schema fields only (no uid, raw_json, or database IDs)."""
    defaults = defaults or {}
    extensions = raw.get("extensions") if isinstance(raw.get("extensions"), dict) else {}
    # Character Card V2's standard position has only before/after. ST stores its
    # full position in extensions and reads that in preference to the standard.
    position = str(extensions.get("position", raw.get("position", "after_char")))
    position = {"0": "before_char", "1": "after_char", "before_char_defs": "before_char", "after_char_defs": "after_char"}.get(position, position)
    enabled = _bool(raw.get("enabled"), "enabled", not _bool(raw.get("disable"), "disable"))
    warnings = []
    if position not in {"before_char", "after_char"}:
        enabled = False
        warnings.append(f"插入位置 {position} 尚未支持；消息深度 @D 等插入位置的条目已停用并保留原文")
    if _bool(_read(raw, "useProbability"), "useProbability") and _read(raw, "probability", default=100) != 100:
        enabled = False
        warnings.append("按概率触发尚未支持，对应条目已停用并保留原文")
    selective = _bool(raw.get("selective"), "selective")
    if selective and _read(raw, "selectiveLogic", default=0) != 0:
        enabled = False
        warnings.append("该次要关键词逻辑尚未支持，对应条目已停用并保留原文")
    order = raw.get("insertion_order", raw.get("order", 100))
    return {
        "keys": _strings(raw.get("keys", raw.get("key"))),
        "secondary_keys": _strings(raw.get("secondary_keys", raw.get("keysecondary"))),
        "content": str(raw.get("content", "")),
        "enabled": enabled,
        "constant": _bool(raw.get("constant"), "constant"),
        "selective": selective,
        "order": int(100 if order is None else order),
        "position": position,
        "depth": _nonnegative(_read(raw, "scanDepth", "scan_depth"), "scanDepth"),
        "case_sensitive": _bool(_read(raw, "case_sensitive", "caseSensitive"), "case_sensitive", defaults.get("case_sensitive", False)),
        "match_whole_words": _bool(_read(raw, "match_whole_words", "matchWholeWords"), "match_whole_words", defaults.get("match_whole_words", False)),
        "exclude_recursion": _bool(_read(raw, "exclude_recursion", "excludeRecursion"), "exclude_recursion"),
        "prevent_recursion": _bool(_read(raw, "prevent_recursion", "preventRecursion"), "prevent_recursion"),
        "delay_until_recursion": _nonnegative(_read(raw, "delay_until_recursion", "delayUntilRecursion"), "delay_until_recursion", 0),
    }, warnings


def worldbook_import_warnings(raw: dict | None) -> list[str]:
    """Recompute persistent import diagnostics without modifying the source."""
    if not isinstance(raw, dict):
        return []
    warnings = []
    for index, entry in enumerate(iter_worldbook_entries(raw), 1):
        try:
            _, entry_warnings = normalize_worldbook_entry(entry)
        except (ValueError, TypeError) as exc:
            entry_warnings = [f"世界书设置无效：{exc}"]
        warnings.extend(f"条目 {index}：{warning}" for warning in entry_warnings)
    return warnings
