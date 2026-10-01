"""Prompt block ordering shared by the provider protocols."""

from __future__ import annotations

from typing import Dict, List

from ... import schemas


def _ordered_prompt_messages(context: schemas.ContextPreviewOut) -> List[Dict[str, str]]:
    if context.compiled_blocks:
        return [
            {"role": block.role, "content": block.content}
            for block in context.compiled_blocks
            if block.content.strip()
        ]
    messages = [{"role": "system", "content": context.system}] if context.system else []
    messages.extend({"role": message.role, "content": message.content} for message in context.messages)
    return messages


def _split_leading_system(context: schemas.ContextPreviewOut) -> tuple[str, List[Dict[str, str]]]:
    leading: List[str] = []
    remaining: List[Dict[str, str]] = []
    in_prefix = True
    for message in _ordered_prompt_messages(context):
        if in_prefix and message["role"] == "system":
            leading.append(message["content"])
            continue
        in_prefix = False
        remaining.append(message)
    return "\n\n".join(leading), remaining
