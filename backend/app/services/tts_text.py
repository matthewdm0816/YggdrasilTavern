"""Extract spoken text without sending narration or reasoning to a TTS service.

The quote/action conventions were informed by SillyTavern's TTS documentation:
https://docs.sillytavern.app/extensions/tts/
This independent parser deliberately returns no text when no dialogue is found.
"""

from dataclasses import dataclass
from html import unescape
import re
from typing import Literal


@dataclass
class TtsTextResult:
    text: str
    segments: list[str]
    warnings: list[str]


_HIDDEN_TAG = re.compile(
    r"<\s*(/?)\s*(think|analysis|reasoning|script|style)\b"
    r"(?:[^>\"']|\"[^\"]*\"|'[^']*')*(?:>|$)",
    re.IGNORECASE,
)
_FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)", re.MULTILINE)
_TTS_TAG = re.compile(r"<tts>|</tts>", re.IGNORECASE)
_QUOTES = {
    '"': '"', "“": "”", "„": "“", "「": "」", "『": "』",
    "＂": "＂", "«": "»", "»": "«", "‘": "’", "‚": "‘",
}


def _warn(warnings: list[str], message: str) -> None:
    if message not in warnings:
        warnings.append(message)


def _escaped(text: str, index: int) -> bool:
    backslashes = 0
    while index > 0 and text[index - 1] == "\\":
        index -= 1
        backslashes += 1
    return backslashes % 2 == 1


def _remove_code(text: str, warnings: list[str]) -> str:
    """Remove complete code spans, and suppress an unfinished span's remainder."""
    output: list[str] = []
    position = 0
    while position < len(text):
        fence = _FENCE.match(text, position)
        if fence:
            delimiter = fence.group(1)
            close = re.compile(
                r"^ {0,3}" + re.escape(delimiter[0]) + "{" + str(len(delimiter))
                + r",}[ \t]*(?:\n|$)", re.MULTILINE,
            ).search(text, fence.end())
            if close is None:
                _warn(warnings, "未闭合的代码块及其后续内容已跳过。")
                break
            output.append("\n")
            position = close.end()
            continue
        if text[position] == "`" and not _escaped(text, position):
            run_end = position + 1
            while run_end < len(text) and text[run_end] == "`":
                run_end += 1
            delimiter = text[position:run_end]
            close = re.compile(r"(?<!`)" + re.escape(delimiter) + r"(?!`)").search(text, run_end)
            if close is None:
                _warn(warnings, "未闭合的行内代码及其后续内容已跳过。")
                break
            output.append(" ")
            position = close.end()
            continue
        output.append(text[position])
        position += 1
    return "".join(output)


def _remove_hidden(text: str, warnings: list[str]) -> str:
    """Handle nested reasoning tags without exposing a partially closed block."""
    output: list[str] = []
    stack: list[str] = []
    position = 0
    while position < len(text):
        if text.startswith("<!--", position):
            end = text.find("-->", position + 4)
            if end < 0:
                _warn(warnings, "未闭合的 HTML 注释及其后续内容已跳过。")
                break
            if not stack:
                output.append(" ")
            position = end + 3
            continue
        tag = _HIDDEN_TAG.match(text, position)
        if tag:
            name = tag.group(2).lower()
            if tag.group(1):
                if stack and stack[-1] == name:
                    stack.pop()
                    if not stack:
                        output.append(" ")
            elif not tag.group().endswith("/>"):
                stack.append(name)
            position = tag.end()
            continue
        if not stack:
            output.append(text[position])
        position += 1
    if stack:
        _warn(warnings, "未闭合的思考或隐藏标签及其后续内容已跳过。")
    return "".join(output)


def _remove_actions(text: str, warnings: list[str]) -> str:
    output: list[str] = []
    position = 0
    while position < len(text):
        if text[position] != "*" or _escaped(text, position):
            output.append(text[position])
            position += 1
            continue
        end = position + 1
        while end < len(text) and text[end] == "*":
            end += 1
        if end - position > 1:
            position = end  # Bold emphasis is formatting, not an action block.
            continue
        if end >= len(text) or text[end].isspace():
            output.append("*")
            position = end
            continue
        closing = end
        while closing < len(text):
            if (text[closing] == "*" and not _escaped(text, closing)
                    and text[closing - 1] != "*"
                    and (closing + 1 == len(text) or text[closing + 1] != "*")):
                break
            closing += 1
        if closing == len(text):
            _warn(warnings, "未闭合的星号动作描述及其后续内容已跳过。")
            break
        output.append(" ")
        position = closing + 1
    return "".join(output)


def _clean_segment(text: str) -> str:
    # Keep the written words and provider-specific cues such as (laughs).
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"</?[A-Za-z][^<>]*>", " ", text)
    text = re.sub(r"(?<!\\)(?:\*{1,3}|~~)", "", text)
    text = re.sub(r"(?<!\w)_{1,2}|_{1,2}(?!\w)", "", text)
    text = re.sub(r"\\([\\`*_{}\[\]()#+.!<>\"'])", r"\1", text)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _tag_segments(text: str, warnings: list[str]) -> list[str]:
    segments: list[str] = []
    depth = 0
    start = 0
    for tag in _TTS_TAG.finditer(text):
        if tag.group().lower() == "<tts>":
            if depth == 0:
                start = tag.end()
            else:
                _warn(warnings, "嵌套的 <tts> 标签已合并为一个朗读片段。")
            depth += 1
        elif depth:
            depth -= 1
            if depth == 0:
                segments.append(text[start:tag.start()])
    if depth:
        _warn(warnings, "未闭合的 <tts> 标签内容已跳过。")
    return segments


def _dialogue_segments(text: str, warnings: list[str]) -> list[str]:
    # Attribute values and image descriptions are not character dialogue.
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"</?[A-Za-z][^<>]*>", " ", text)
    text = _remove_actions(text, warnings)
    segments: list[str] = []
    stack: list[tuple[str, int]] = []
    for index, char in enumerate(text):
        if _escaped(text, index):
            continue
        if stack and char == stack[-1][0]:
            _, start = stack.pop()
            if not stack:
                segments.append(text[start + 1:index])
        elif char in _QUOTES:
            stack.append((_QUOTES[char], index))
        elif stack and char == "\n" and index and text[index - 1] == "\n":
            # Recover at paragraph boundaries instead of losing later dialogue.
            stack.clear()
            _warn(warnings, "未闭合的引号内容已跳过。")
    if stack:
        _warn(warnings, "未闭合的引号内容已跳过。")
    return segments


def extract_tts_text(content: str, mode: Literal["tags", "dialogue"]) -> TtsTextResult:
    """Return only explicit TTS blocks or quoted dialogue, never a prose fallback."""
    if mode not in ("tags", "dialogue"):
        raise ValueError(f"Unsupported TTS extraction mode: {mode!r}")
    warnings: list[str] = []
    text = _remove_hidden(_remove_code(content.replace("\r\n", "\n"), warnings), warnings)
    raw_segments = _tag_segments(text, warnings) if mode == "tags" else _dialogue_segments(text, warnings)
    segments = [cleaned for segment in raw_segments if (cleaned := _clean_segment(segment))]
    if not segments:
        _warn(warnings, "没有找到可朗读的完整 <tts> 标签内容。" if mode == "tags"
              else "没有找到可朗读的完整引号内对白。")
    return TtsTextResult(text="\n".join(segments), segments=segments, warnings=warnings)
