from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from .. import models, schemas
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
        next_size = used + len(candidate.content)
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
    user_name = str((session.preset or {}).get("user_name") or "User")
    path = path_override if path_override is not None else active_path(db, session)

    worldbook_candidates = []
    scan_depth = 8
    budget = 4000
    if session.worldbook:
        scan_depth = session.worldbook.scan_depth
        budget = session.worldbook.token_budget
        worldbook_candidates.extend(_candidate_from_entry(entry) for entry in session.worldbook.entries)
    worldbook_candidates.extend(_candidates_from_character_book(character))
    activated_lore = activate_lore(worldbook_candidates, path, scan_depth=scan_depth, budget=budget)

    original_system = str((session.preset or {}).get("system_prompt") or DEFAULT_SYSTEM)
    character_system = expand_macros(character.system_prompt if character else "", character, user_name, original_system)
    system_parts = [character_system or original_system]

    lore_before = [item.content for item in activated_lore if item.position in {"before_char", "before_char_defs", "0"}]
    lore_after = [item.content for item in activated_lore if item.position not in {"before_char", "before_char_defs", "0"}]
    if lore_before:
        system_parts.append("[World Info]\n" + "\n\n".join(expand_macros(item, character, user_name) for item in lore_before))

    if character:
        char_sections = []
        if character.description:
            char_sections.append("Description:\n" + character.description)
        if character.personality:
            char_sections.append("Personality:\n" + character.personality)
        if character.scenario:
            char_sections.append("Scenario:\n" + character.scenario)
        if character.mes_example:
            char_sections.append("Example dialogue:\n" + character.mes_example)
        if char_sections:
            system_parts.append(expand_macros("\n\n".join(char_sections), character, user_name))

    if lore_after:
        system_parts.append("[World Info]\n" + "\n\n".join(expand_macros(item, character, user_name) for item in lore_after))

    if character and character.post_history_instructions:
        system_parts.append(expand_macros(character.post_history_instructions, character, user_name))

    prompt_messages = [
        schemas.PromptMessage(
            role=message.role,
            speaker=message.speaker,
            content=expand_macros(message.content, character, user_name),
        )
        for message in path
        if message.role in {"user", "assistant"} and message.status != "failed"
    ]

    return schemas.ContextPreviewOut(
        system="\n\n".join(part for part in system_parts if part.strip()),
        messages=prompt_messages,
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
    )
