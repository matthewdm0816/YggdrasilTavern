"""Deterministic prose lint for Chinese light-novel drafts."""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from .project import LintConfig

CLICHES = [
    "嘴角勾起", "嘴角微微上扬", "勾起一抹", "眼中闪过一丝", "眸中闪过", "眼底闪过", "空气仿佛凝固",
    "时间仿佛静止", "心中涌起一股", "一股暖流", "命运的齿轮", "倒吸一口凉气", "深邃的眼眸",
    "心跳漏了一拍", "不知为何", "某种说不清",
]
# Words that are fine occasionally but read as machine prose when dense: max uses per 1000 chars.
WATCH = {"仿佛": 2.0, "似乎": 2.0, "不禁": 1.0, "一丝": 1.5, "一抹": 1.0, "淡淡的": 1.5, "微微": 2.0}
META = ["节拍", "伏笔", "细纲", "视点人物", "交稿", "写作要求", "本场"]
SUMMARY_ENDINGS = ("或许", "也许", "从这一刻", "这就是", "那一天，我")
DIALOGUE = re.compile(r"「[^」]*」|“[^”]*”|『[^』]*』")
NGRAM = 8
LONG_PARAGRAPH = 220


@dataclass
class LintReport:
    chars: int
    dialogue_ratio: float
    findings: list[str] = field(default_factory=list)

    def summary(self) -> str:
        return f"{self.chars} 字，对话占 {self.dialogue_ratio:.0%}"


def _repeated_ngrams(text: str) -> list[tuple[str, int]]:
    compact = re.sub(r"\s+", "", text)
    counts = Counter(
        compact[i:i + NGRAM] for i in range(len(compact) - NGRAM + 1)
        if not re.search(r"\W", compact[i:i + NGRAM])  # skip windows that span punctuation
    )
    repeated, covered = [], set()
    for gram, n in counts.most_common():
        if n < 3:
            break
        if any(gram[1:] in c or gram[:-1] in c for c in covered):
            continue
        covered.add(gram)
        repeated.append((gram, n))
    return repeated[:5]


def lint_prose(text: str, target_chars: int, config: LintConfig | None = None) -> LintReport:
    config = config or LintConfig()
    body = re.sub(r"\s+", "", text)
    chars = len(body)
    dialogue = sum(len(m.group(0)) for m in DIALOGUE.finditer(text))
    report = LintReport(chars=chars, dialogue_ratio=dialogue / chars if chars else 0.0)
    f = report.findings
    if not chars:
        f.append("正文是空的")
        return report

    if chars < target_chars * 0.7 or chars > target_chars * 1.4:
        f.append(f"字数 {chars}，目标约 {target_chars}")
    if report.dialogue_ratio < 0.15:
        f.append(f"对话只占 {report.dialogue_ratio:.0%}，叙述过多，不像轻小说的节奏")
    elif report.dialogue_ratio > 0.8:
        f.append(f"对话占 {report.dialogue_ratio:.0%}，几乎没有叙述和描写")

    paragraphs = [p.strip() for p in text.split("\n") if p.strip()]
    long = [p for p in paragraphs if len(p) > LONG_PARAGRAPH]
    if long:
        f.append(f"有 {len(long)} 个段落超过 {LONG_PARAGRAPH} 字，轻小说宜用短段落")

    for phrase in CLICHES + config.banned:
        if (n := text.count(phrase)) > 0:
            f.append(f"套话「{phrase}」出现 {n} 次")
    for word, per_k in {**WATCH, **{w: 1.0 for w in config.watch}}.items():
        n = text.count(word)
        if n > max(1, per_k * chars / 1000):
            f.append(f"「{word}」出现 {n} 次，偏多")
    for gram, n in _repeated_ngrams(text):
        f.append(f"片段「{gram}」重复了 {n} 次")

    leaked = [m for m in META if m in text]
    if leaked or any(p.startswith(("#", "**")) for p in paragraphs):
        f.append(f"正文里混入了写作说明或格式标记：{leaked or 'Markdown 标题/加粗'}")
    if paragraphs[-1].startswith(SUMMARY_ENDINGS):
        f.append("结尾像总结或感悟，轻小说的场景最好停在画面、台词或动作上")
    return report
