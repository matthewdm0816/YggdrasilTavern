"""Shared macro expansion for prompts, speech, counters, and browser context."""
from __future__ import annotations

import re
from typing import Optional, Protocol, Sequence
from .. import models


class MacroSource(Protocol):
    name: str
    description: str
    personality: str
    scenario: str
    first_mes: str
    alternate_greetings: Sequence[str]


def expand_macros(text: str, character: Optional[MacroSource], user_name: str, original: str = "") -> str:
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


def expand_message_content(session: models.ChatSession, content: str) -> str:
    return expand_macros(content, session.character, str((session.preset or {}).get("user_name") or "User"))
