from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

from sqlalchemy.orm import Session

from .. import models, schemas
from .prompt_config import (
    apply_outgoing_regex,
    global_prompt_state,
    parsed_regex_rules,
    unique_worldbook_ids,
)
from .token_counter import count_text_tokens
from .token_limits import ResolvedTokenLimits
from .tree import active_path


DEFAULT_SYSTEM = (
    "You are participating in an immersive roleplay webchat. "
    "Stay in character, respect the established scene, and continue naturally from the conversation history."
)


@dataclass
class LoreCandidate:
    id: str
    worldbook_id: str
    keys: List[str]
    secondary_keys: List[str]
    content: str
    enabled: bool = True
    constant: bool = False
    selective: bool = False
    order: int = 100
    position: str = "after_char"
    depth: Optional[int] = None
    case_sensitive: bool = False
    match_whole_words: bool = False


def expand_macros(text: str, character: Optional[models.Character], user_name: str, original: str = "") -> str:
    if not text:
        return ""
    char_name = character.name if character else "Assistant"
    replacements = {
        "{{char}}": char_name,
        "<BOT>": char_name,
        "{{user}}": user_name,
        "<USER>": user_name,
        "{{description}}": character.description if character else "",
        "{{personality}}": character.personality if character else "",
        "{{scenario}}": character.scenario if character else "",
        "{{charFirstMessage}}": character.first_mes if character else "",
        "{{original}}": original,
    }
    result = text
    for key, value in replacements.items():
        result = result.replace(key, value)

    if character:
        greetings = [character.first_mes] + list(character.alternate_greetings or [])

        def greeting(match: re.Match[str]) -> str:
            index = int(match.group(1))
            return greetings[index] if 0 <= index < len(greetings) else ""

        result = re.sub(r"\{\{charFirstMessage::(\d+)\}\}", greeting, result)
    return result


def _candidate_from_entry(entry: models.WorldBookEntry) -> LoreCandidate:
    return LoreCandidate(
        id=entry.id,
        worldbook_id=entry.worldbook_id,
        keys=list(entry.keys or []),
        secondary_keys=list(entry.secondary_keys or []),
        content=entry.content,
        enabled=entry.enabled,
        constant=entry.constant,
        selective=entry.selective,
        order=entry.order,
        position=entry.position,
        depth=entry.depth,
        case_sensitive=entry.case_sensitive,
        match_whole_words=entry.match_whole_words,
    )


def _candidates_from_character_book(character: Optional[models.Character]) -> List[LoreCandidate]:
    if not character or not character.character_book:
        return []
    raw_entries = character.character_book.get("entries", [])
    if isinstance(raw_entries, dict):
        iterable = raw_entries.values()
    else:
        iterable = raw_entries
    candidates: List[LoreCandidate] = []
    for idx, raw in enumerate(iterable):
        if not isinstance(raw, dict):
            continue
        keys = raw.get("keys", raw.get("key", []))
        if isinstance(keys, str):
            keys = [part.strip() for part in keys.split(",") if part.strip()]
        secondary = raw.get("secondary_keys", raw.get("keysecondary", []))
        if isinstance(secondary, str):
            secondary = [part.strip() for part in secondary.split(",") if part.strip()]
        candidates.append(
            LoreCandidate(
                id=f"character_book:{idx}",
                worldbook_id=f"character:{character.id}",
                keys=list(keys or []),
                secondary_keys=list(secondary or []),
                content=str(raw.get("content", "")),
                enabled=bool(raw.get("enabled", not raw.get("disable", False))),
                constant=bool(raw.get("constant", False)),
                selective=bool(raw.get("selective", False)),
                order=int(raw.get("insertion_order", raw.get("order", 100)) or 100),
                position=str(raw.get("position", "after_char")),
                depth=raw.get("depth"),
                case_sensitive=bool(raw.get("case_sensitive", False)),
                match_whole_words=bool(raw.get("match_whole_words", False)),
            )
        )
    return candidates


def _regex_parts(key: str) -> Optional[tuple[str, int]]:
    if len(key) < 2 or not key.startswith("/"):
        return None
    last = key.rfind("/")
    if last <= 0:
        return None
    pattern = key[1:last]
    flags_text = key[last + 1 :]
    flags = 0
    if "i" in flags_text:
        flags |= re.IGNORECASE
    if "m" in flags_text:
        flags |= re.MULTILINE
    if "s" in flags_text:
        flags |= re.DOTALL
    return pattern, flags


def _match_key(key: str, text: str, *, case_sensitive: bool, whole_words: bool) -> bool:
    if not key:
        return False
    regex = _regex_parts(key)
    if regex:
        pattern, flags = regex
        if not case_sensitive:
            flags |= re.IGNORECASE
        try:
            return re.search(pattern, text, flags) is not None
        except re.error:
            return False

    if whole_words:
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            return re.search(rf"\b{re.escape(key)}\b", text, flags) is not None
        except re.error:
            return False
    if case_sensitive:
        return key in text
    return key.lower() in text.lower()


def _matches_any(keys: Iterable[str], text: str, candidate: LoreCandidate) -> bool:
    return any(
        _match_key(
            key,
            text,
            case_sensitive=candidate.case_sensitive,
            whole_words=candidate.match_whole_words,
        )
        for key in keys
    )


def activate_lore(
    candidates: Iterable[LoreCandidate],
    messages: List[models.Message],
    *,
    scan_depth: int,
    budget: int,
) -> List[LoreCandidate]:
    scan_messages = messages[-scan_depth:] if scan_depth > 0 else []
    scan_text = "\n".join(f"{message.speaker or message.role}: {message.content}" for message in scan_messages)
    activated: List[LoreCandidate] = []
    used = 0
    for candidate in sorted(candidates, key=lambda item: item.order):
        if not candidate.enabled or not candidate.content.strip():
            continue
        entry_scan_depth = candidate.depth if candidate.depth is not None else scan_depth
        if entry_scan_depth != scan_depth:
            entry_messages = messages[-entry_scan_depth:] if entry_scan_depth and entry_scan_depth > 0 else []
            entry_scan_text = "\n".join(f"{message.speaker or message.role}: {message.content}" for message in entry_messages)
        else:
            entry_scan_text = scan_text

        primary = _matches_any(candidate.keys, entry_scan_text, candidate)
        secondary = _matches_any(candidate.secondary_keys, entry_scan_text, candidate)
        should_activate = candidate.constant or (primary and (secondary or not candidate.selective))
        if not should_activate:
            continue
        next_size = used + count_text_tokens(candidate.content)
        if budget > 0 and next_size > budget:
            continue
        activated.append(candidate)
        used = next_size
    return activated


def build_context(
    db: Session,
    session: models.ChatSession,
    path_override: Optional[List[models.Message]] = None,
) -> schemas.ContextPreviewOut:
    character = session.character
    preset = session.preset or {}
    user_name = str(preset.get("user_name") or "User")
    path = path_override if path_override is not None else active_path(db, session)
    diagnostics: List[schemas.PromptDiagnostic] = []

    try:
        worldbook_ids = unique_worldbook_ids(session.worldbook_id, preset)
    except ValueError as exc:
        worldbook_ids = [session.worldbook_id] if session.worldbook_id else []
        diagnostics.append(schemas.PromptDiagnostic(level="error", code="invalid_worldbook_ids", message=str(exc)))

    activated_lore: List[LoreCandidate] = []
    loaded_worldbook_ids: List[str] = []
    for worldbook_id in worldbook_ids:
        worldbook = db.get(models.WorldBook, worldbook_id)
        if not worldbook:
            diagnostics.append(
                schemas.PromptDiagnostic(
                    level="error",
                    code="missing_worldbook",
                    message=f"Worldbook '{worldbook_id}' does not exist",
                )
            )
            continue
        loaded_worldbook_ids.append(worldbook.id)
        candidates = [_candidate_from_entry(entry) for entry in worldbook.entries]
        activated_lore.extend(
            activate_lore(candidates, path, scan_depth=worldbook.scan_depth, budget=worldbook.token_budget)
        )

    # An embedded character book is an independent source with its own conservative budget.
    activated_lore.extend(
        activate_lore(_candidates_from_character_book(character), path, scan_depth=8, budget=4000)
    )
    activated_lore.sort(key=lambda item: (item.order, item.worldbook_id, item.id))

    lore_before = [item.content for item in activated_lore if item.position in {"before_char", "before_char_defs", "0"}]
    lore_after = [item.content for item in activated_lore if item.position not in {"before_char", "before_char_defs", "0"}]
    original_system = str(preset.get("system_prompt") or DEFAULT_SYSTEM)

    slots, prompt_config_revision, _, prompt_config_error = global_prompt_state(db)
    if prompt_config_error:
        diagnostics.append(
            schemas.PromptDiagnostic(
                level="error",
                code="invalid_global_prompt_config",
                message=prompt_config_error,
            )
        )
    try:
        regex_rules = parsed_regex_rules(preset)
    except ValueError as exc:
        regex_rules = []
        diagnostics.append(schemas.PromptDiagnostic(level="error", code="invalid_regex_rules", message=str(exc)))

    compiled_blocks: List[schemas.CompiledPromptBlock] = []

    def source_content(slot: schemas.PromptSlot) -> tuple[str, str]:
        if slot.kind == "main":
            if character and character.system_prompt:
                return character.system_prompt, "character.system_prompt"
            if preset.get("system_prompt"):
                return original_system, "session.system_prompt"
            return original_system, "default.main_prompt"
        if slot.kind == "world_before":
            return _world_info_text(lore_before, character, user_name), "worldbooks.before"
        if slot.kind == "char_description":
            value = f"Description:\n{character.description}" if character and character.description else ""
            return value, "character.description"
        if slot.kind == "char_personality":
            value = f"Personality:\n{character.personality}" if character and character.personality else ""
            return value, "character.personality"
        if slot.kind == "scenario":
            value = f"Scenario:\n{character.scenario}" if character and character.scenario else ""
            return value, "character.scenario"
        if slot.kind == "examples":
            value = f"Example dialogue:\n{character.mes_example}" if character and character.mes_example else ""
            return value, "character.mes_example"
        if slot.kind == "pre_history":
            value = str(preset.get("pre_history_instruction") or preset.get("pre_history_instructions") or "")
            return value, "session.pre_history_instruction"
        if slot.kind == "world_after":
            return _world_info_text(lore_after, character, user_name), "worldbooks.after"
        if slot.kind == "post_history":
            value = character.post_history_instructions if character else ""
            return value, "character.post_history_instructions"
        return slot.content or "", "global.custom_prompt"

    for slot in slots:
        if not slot.enabled:
            continue
        if slot.kind == "history":
            for message in path:
                if message.role not in {"user", "assistant"}:
                    continue
                content = expand_macros(message.content, character, user_name)
                transformed, regex_diagnostics = apply_outgoing_regex(content, regex_rules)
                diagnostics.extend(_diagnostics_for_slot(regex_diagnostics, slot.id))
                if not transformed.strip():
                    continue
                compiled_blocks.append(
                    schemas.CompiledPromptBlock(
                        slot_id=slot.id,
                        slot_kind=slot.kind,
                        slot_name=slot.name,
                        source=f"message:{message.id}",
                        role=message.role,
                        content=transformed,
                        token_count=count_text_tokens(transformed),
                        is_history=True,
                        message_id=message.id,
                        speaker=message.speaker,
                    )
                )
            continue

        raw_content, source = source_content(slot)
        if slot.content is not None:
            raw_content = slot.content
            source = f"{source}.override"
        content = expand_macros(raw_content, character, user_name, original_system)
        transformed, regex_diagnostics = apply_outgoing_regex(content, regex_rules)
        diagnostics.extend(_diagnostics_for_slot(regex_diagnostics, slot.id))
        if not transformed.strip():
            continue
        compiled_blocks.append(
            schemas.CompiledPromptBlock(
                slot_id=slot.id,
                slot_kind=slot.kind,
                slot_name=slot.name,
                source=source,
                role=slot.role,
                content=transformed,
                token_count=count_text_tokens(transformed),
            )
        )
    compat_system, compat_messages = _compat_context(compiled_blocks)
    estimated_input_tokens = sum(block.token_count + 4 for block in compiled_blocks)
    return schemas.ContextPreviewOut(
        system=compat_system,
        messages=compat_messages,
        activated_lore=[
            schemas.ActivatedLore(
                id=item.id,
                worldbook_id=item.worldbook_id,
                order=item.order,
                position=item.position,
                content=item.content,
                keys=item.keys,
            )
            for item in activated_lore
        ],
        compiled_blocks=compiled_blocks,
        diagnostics=diagnostics,
        worldbook_ids=loaded_worldbook_ids,
        prompt_config_revision=prompt_config_revision,
        estimated_input_tokens=estimated_input_tokens,
    )


def apply_context_token_limit(
    context: schemas.ContextPreviewOut,
    *,
    model: str,
    limits: ResolvedTokenLimits,
) -> schemas.ContextPreviewOut:
    """Keep fixed prompt blocks and the newest contiguous history suffix.

    The operation only trims the compiled copy of the currently selected tree
    path. It never mutates messages or branch selection in the database.
    """

    blocks = [
        block.model_copy(update={"token_count": count_text_tokens(block.content, model)})
        for block in context.compiled_blocks
    ]
    costs = [block.token_count + 4 for block in blocks]
    total = sum(costs)
    history_indices = [index for index, block in enumerate(blocks) if block.is_history]
    minimum_history = min(2, len(history_indices))
    droppable = history_indices[: len(history_indices) - minimum_history]
    dropped_indices: set[int] = set()
    dropped_tokens = 0

    for index in droppable:
        if total <= limits.effective_input_tokens:
            break
        dropped_indices.add(index)
        dropped_tokens += costs[index]
        total -= costs[index]

    kept_blocks = [block for index, block in enumerate(blocks) if index not in dropped_indices]
    diagnostics = list(context.diagnostics)
    if dropped_indices:
        diagnostics.append(
            schemas.PromptDiagnostic(
                level="warning",
                code="history_truncated",
                message=(
                    f"输入预算为 {limits.effective_input_tokens} tokens；"
                    f"已从当前树路径移除最旧的 {len(dropped_indices)} 条历史消息"
                ),
                match_count=len(dropped_indices),
            )
        )
    if total > limits.effective_input_tokens:
        diagnostics.append(
            schemas.PromptDiagnostic(
                level="error",
                code="context_limit_exceeded",
                message=(
                    f"固定 Prompt 与必须保留的最近 {minimum_history} 条历史约需 {total} tokens，"
                    f"超过生效输入上限 {limits.effective_input_tokens}；请调高上限或缩短内容"
                ),
            )
        )

    system, messages = _compat_context(kept_blocks)
    return context.model_copy(
        update={
            "system": system,
            "messages": messages,
            "compiled_blocks": kept_blocks,
            "diagnostics": diagnostics,
            "configured_input_token_limit": limits.configured_input_tokens,
            "effective_input_token_limit": limits.effective_input_tokens,
            "configured_output_token_limit": limits.configured_output_tokens,
            "effective_output_token_limit": limits.effective_output_tokens,
            "model_max_input_tokens": limits.model_max_input_tokens,
            "model_max_output_tokens": limits.model_max_output_tokens,
            "model_max_total_tokens": limits.model_max_total_tokens,
            "estimated_input_tokens": total,
            "dropped_history_count": len(dropped_indices),
            "dropped_history_tokens": dropped_tokens,
        }
    )


def _world_info_text(contents: Sequence[str], character: Optional[models.Character], user_name: str) -> str:
    if not contents:
        return ""
    return "[World Info]\n" + "\n\n".join(expand_macros(item, character, user_name) for item in contents)


def _diagnostics_for_slot(
    diagnostics: Sequence[schemas.PromptDiagnostic], slot_id: str
) -> List[schemas.PromptDiagnostic]:
    return [diagnostic.model_copy(update={"slot_id": slot_id}) for diagnostic in diagnostics]


def _compat_context(
    blocks: Sequence[schemas.CompiledPromptBlock],
) -> tuple[str, List[schemas.PromptMessage]]:
    leading_system: List[str] = []
    messages: List[schemas.PromptMessage] = []
    prefix = True
    for block in blocks:
        if prefix and block.role == "system" and not block.is_history:
            leading_system.append(block.content)
            continue
        prefix = False
        messages.append(
            schemas.PromptMessage(role=block.role, content=block.content, speaker=block.speaker)
        )
    return "\n\n".join(leading_system), messages


def prompt_errors(context: schemas.ContextPreviewOut) -> List[schemas.PromptDiagnostic]:
    return [diagnostic for diagnostic in context.diagnostics if diagnostic.level == "error"]
