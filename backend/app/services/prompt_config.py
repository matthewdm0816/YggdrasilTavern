from __future__ import annotations

import re
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Sequence

from pydantic import ValidationError
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas


BUILTIN_SLOT_KINDS: tuple[str, ...] = (
    "main",
    "world_before",
    "char_description",
    "char_personality",
    "scenario",
    "examples",
    "pre_history",
    "history",
    "world_after",
    "post_history",
)

DEFAULT_PROMPT_SLOTS: tuple[dict[str, Any], ...] = (
    {"id": "main", "kind": "main", "name": "Main Prompt", "enabled": True, "role": "system", "content": None},
    {"id": "world_before", "kind": "world_before", "name": "World Info Before", "enabled": True, "role": "system", "content": None},
    {"id": "char_description", "kind": "char_description", "name": "Character Description", "enabled": True, "role": "system", "content": None},
    {"id": "char_personality", "kind": "char_personality", "name": "Character Personality", "enabled": True, "role": "system", "content": None},
    {"id": "scenario", "kind": "scenario", "name": "Scenario", "enabled": True, "role": "system", "content": None},
    {"id": "examples", "kind": "examples", "name": "Example Dialogue", "enabled": True, "role": "system", "content": None},
    {"id": "pre_history", "kind": "pre_history", "name": "Pre-History Instruction", "enabled": True, "role": "system", "content": None},
    {"id": "history", "kind": "history", "name": "Chat History", "enabled": True, "role": "system", "content": None},
    {"id": "world_after", "kind": "world_after", "name": "World Info After", "enabled": True, "role": "system", "content": None},
    {"id": "post_history", "kind": "post_history", "name": "Post-History Instruction", "enabled": True, "role": "system", "content": None},
)

GLOBAL_PROMPT_CONFIG_ID = "default"


class PromptConfigConflict(ValueError):
    pass


def default_prompt_slots() -> List[Dict[str, Any]]:
    return deepcopy(list(DEFAULT_PROMPT_SLOTS))


def _validation_detail(prefix: str, exc: ValidationError) -> ValueError:
    details = "; ".join(
        f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}" for item in exc.errors()
    )
    return ValueError(f"{prefix}: {details}")


def normalize_prompt_slots(raw_slots: Any) -> List[Dict[str, Any]]:
    if raw_slots is None:
        return default_prompt_slots()
    if not isinstance(raw_slots, list):
        raise ValueError("prompt_slots must be a list")

    slots: List[schemas.PromptSlot] = []
    for index, raw in enumerate(raw_slots):
        try:
            slots.append(schemas.PromptSlot.model_validate(raw))
        except ValidationError as exc:
            raise _validation_detail(f"Invalid prompt_slots[{index}]", exc) from exc

    ids = [slot.id for slot in slots]
    if len(ids) != len(set(ids)):
        raise ValueError("prompt_slots ids must be unique")

    for kind in BUILTIN_SLOT_KINDS:
        matching = [slot for slot in slots if slot.kind == kind]
        if len(matching) != 1:
            raise ValueError(f"prompt_slots must contain exactly one required '{kind}' slot")
        if matching[0].id != kind:
            raise ValueError(f"Required '{kind}' slot id must remain '{kind}'")

    return [slot.model_dump(mode="json") for slot in slots]


def _compile_flags(flags_text: str) -> tuple[int, bool]:
    if len(flags_text) != len(set(flags_text)):
        raise ValueError("Regex flags must not contain duplicates")
    flags = 0
    replace_all = False
    for flag in flags_text:
        if flag == "i":
            flags |= re.IGNORECASE
        elif flag == "m":
            flags |= re.MULTILINE
        elif flag == "s":
            flags |= re.DOTALL
        elif flag == "g":
            replace_all = True
        else:
            raise ValueError(f"Unsupported regex flag '{flag}'")
    return flags, replace_all


def normalize_regex_rules(raw_rules: Any) -> List[Dict[str, Any]]:
    if raw_rules is None:
        return []
    if not isinstance(raw_rules, list):
        raise ValueError("regex_rules must be a list")

    rules: List[schemas.RegexRule] = []
    for index, raw in enumerate(raw_rules):
        try:
            rule = schemas.RegexRule.model_validate(raw)
        except ValidationError as exc:
            raise _validation_detail(f"Invalid regex_rules[{index}]", exc) from exc
        if rule.mode == "veil" and "outgoing_prompt" in rule.targets:
            raise ValueError(f"Regex rule '{rule.id}' cannot use veil mode for outgoing_prompt")
        if "outgoing_prompt" in rule.targets:
            try:
                python_flags, _ = _compile_flags(rule.flags)
                re.compile(rule.pattern, python_flags)
            except (re.error, ValueError) as exc:
                raise ValueError(f"Invalid outgoing regex_rules[{index}] ({rule.id}): {exc}") from exc
        rules.append(rule)

    ids = [rule.id for rule in rules]
    if len(ids) != len(set(ids)):
        raise ValueError("regex_rules ids must be unique")
    return [rule.model_dump(mode="json") for rule in rules]


def normalize_worldbook_ids(raw_ids: Any) -> List[str]:
    if raw_ids is None:
        return []
    if not isinstance(raw_ids, list):
        raise ValueError("worldbook_ids must be a list")
    result: List[str] = []
    for index, raw in enumerate(raw_ids):
        if not isinstance(raw, str) or not raw.strip():
            raise ValueError(f"worldbook_ids[{index}] must be a non-empty string")
        value = raw.strip()
        if value not in result:
            result.append(value)
    return result


def normalize_session_preset(raw_preset: Any) -> Dict[str, Any]:
    if raw_preset is None:
        raw_preset = {}
    if not isinstance(raw_preset, dict):
        raise ValueError("preset must be an object")
    preset = dict(raw_preset)
    if "prompt_slots" in preset:
        raise ValueError("Prompt Slots 已迁移为全局配置，请使用 /api/settings/prompt")
    preset["regex_rules"] = normalize_regex_rules(preset.get("regex_rules"))
    preset["worldbook_ids"] = normalize_worldbook_ids(preset.get("worldbook_ids"))
    return preset


def parsed_prompt_slots(preset: Dict[str, Any] | None) -> List[schemas.PromptSlot]:
    normalized = normalize_prompt_slots((preset or {}).get("prompt_slots"))
    return [schemas.PromptSlot.model_validate(slot) for slot in normalized]


def global_prompt_state(
    db: Session,
) -> tuple[List[schemas.PromptSlot], int, Optional[datetime], Optional[str]]:
    """Read the singleton without mutating the database.

    A corrupt row falls back for prompt compilation, but the returned error is
    always surfaced as a diagnostic (and as a server error by the settings API).
    """

    row = db.get(models.GlobalPromptConfig, GLOBAL_PROMPT_CONFIG_ID)
    if row is None:
        slots = [schemas.PromptSlot.model_validate(slot) for slot in default_prompt_slots()]
        return slots, 0, None, None
    try:
        normalized = normalize_prompt_slots(row.prompt_slots)
    except ValueError as exc:
        slots = [schemas.PromptSlot.model_validate(slot) for slot in default_prompt_slots()]
        return slots, row.revision, row.updated_at, str(exc)
    return (
        [schemas.PromptSlot.model_validate(slot) for slot in normalized],
        row.revision,
        row.updated_at,
        None,
    )


def save_global_prompt_config(
    db: Session,
    *,
    raw_slots: Any,
    expected_revision: int,
) -> models.GlobalPromptConfig:
    normalized = normalize_prompt_slots(raw_slots)
    row = db.get(models.GlobalPromptConfig, GLOBAL_PROMPT_CONFIG_ID)
    if row is None:
        if expected_revision != 0:
            raise PromptConfigConflict("全局 Prompt 已被其他窗口修改，请刷新后重试")
        row = models.GlobalPromptConfig(
            id=GLOBAL_PROMPT_CONFIG_ID,
            prompt_slots=normalized,
            revision=1,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise PromptConfigConflict("全局 Prompt 已被其他窗口创建，请刷新后重试") from exc
        db.refresh(row)
        return row

    result = db.execute(
        update(models.GlobalPromptConfig)
        .where(
            models.GlobalPromptConfig.id == GLOBAL_PROMPT_CONFIG_ID,
            models.GlobalPromptConfig.revision == expected_revision,
        )
        .values(
            prompt_slots=normalized,
            revision=expected_revision + 1,
            updated_at=models.utc_now(),
        )
    )
    if result.rowcount != 1:
        db.rollback()
        raise PromptConfigConflict("全局 Prompt 已被其他窗口修改，请刷新后重试")
    db.commit()
    saved = db.get(models.GlobalPromptConfig, GLOBAL_PROMPT_CONFIG_ID)
    if saved is None:
        raise RuntimeError("全局 Prompt 保存后无法重新读取")
    return saved


def parsed_regex_rules(preset: Dict[str, Any] | None) -> List[schemas.RegexRule]:
    normalized = normalize_regex_rules((preset or {}).get("regex_rules"))
    return [schemas.RegexRule.model_validate(rule) for rule in normalized]


def apply_outgoing_regex(
    text: str,
    rules: Sequence[schemas.RegexRule],
) -> tuple[str, List[schemas.PromptDiagnostic]]:
    result = text
    diagnostics: List[schemas.PromptDiagnostic] = []
    for rule in rules:
        if not rule.enabled or rule.mode != "replace" or "outgoing_prompt" not in rule.targets:
            continue
        try:
            python_flags, replace_all = _compile_flags(rule.flags)
            pattern = re.compile(rule.pattern, python_flags)
            result, count = pattern.subn(
                lambda match: _javascript_replacement(match, rule.replacement),
                result,
                count=0 if replace_all else 1,
            )
            if count:
                diagnostics.append(
                    schemas.PromptDiagnostic(
                        level="info",
                        code="regex_applied",
                        message=f"Regex rule '{rule.name or rule.id}' matched {count} time(s)",
                        rule_id=rule.id,
                        match_count=count,
                    )
                )
        except (re.error, ValueError) as exc:
            diagnostics.append(
                schemas.PromptDiagnostic(
                    level="error",
                    code="invalid_regex",
                    message=f"Regex rule '{rule.name or rule.id}' failed: {exc}",
                    rule_id=rule.id,
                )
            )
    return result, diagnostics


def _javascript_replacement(match: re.Match[str], replacement: str) -> str:
    """Expand the common JavaScript String.replace replacement tokens."""
    output: List[str] = []
    index = 0
    while index < len(replacement):
        if replacement[index] != "$" or index + 1 >= len(replacement):
            output.append(replacement[index])
            index += 1
            continue
        marker = replacement[index + 1]
        if marker == "$":
            output.append("$")
            index += 2
            continue
        if marker == "&":
            output.append(match.group(0))
            index += 2
            continue
        if marker == "`":
            output.append(match.string[: match.start()])
            index += 2
            continue
        if marker == "'":
            output.append(match.string[match.end() :])
            index += 2
            continue
        if marker == "<":
            close = replacement.find(">", index + 2)
            if close != -1:
                name = replacement[index + 2 : close]
                if name in match.groupdict():
                    output.append(match.groupdict().get(name) or "")
                    index = close + 1
                    continue
        if marker.isdigit() and marker != "0":
            end = index + 2
            if end < len(replacement) and replacement[end].isdigit():
                end += 1
            group_number = int(replacement[index + 1 : end])
            if group_number <= (match.re.groups or 0):
                output.append(match.group(group_number) or "")
                index = end
                continue
        output.append("$")
        index += 1
    return "".join(output)


def unique_worldbook_ids(legacy_worldbook_id: str | None, preset: Dict[str, Any] | None) -> List[str]:
    values: Iterable[str | None] = [legacy_worldbook_id, *normalize_worldbook_ids((preset or {}).get("worldbook_ids"))]
    result: List[str] = []
    for value in values:
        if value and value not in result:
            result.append(value)
    return result
