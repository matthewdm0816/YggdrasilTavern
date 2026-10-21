"""Deterministic plan validators: foreshadowing, power creep, cast, motifs, pacing, drift.

These run without any model call so they can gate every planning step.
"""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass
from typing import Literal

from .schema import Bible, ChapterPlan, Ledger, VolumeOutline

MAX_ABSENCE = 3          # consecutive chapters a recurring character / thread may be absent
MIN_PAYOFF_GAP = 2       # chapters between planting and paying off a foreshadow
MAX_NEW_ABILITIES = 2    # newly introduced abilities per volume


@dataclass
class Issue:
    level: Literal["error", "warn"]
    where: str
    message: str

    def __str__(self) -> str:
        mark = "✗" if self.level == "error" else "⚠"
        return f"{mark} [{self.where}] {self.message}"


def _dupes(ids: list[str]) -> list[str]:
    return [i for i, n in Counter(ids).items() if n > 1]


def _longest_gap(chapters: list[int]) -> tuple[int, int, int]:
    """Largest number of chapters skipped between consecutive appearances: (gap, after, before)."""
    ordered = sorted(set(chapters))
    best = (0, 0, 0)
    for a, b in zip(ordered, ordered[1:]):
        if b - a - 1 > best[0]:
            best = (b - a - 1, a, b)
    return best


# ------------------------------------------------------------------ bible


def check_bible(bible: Bible) -> list[Issue]:
    issues: list[Issue] = []
    where = "设定集"
    char_ids = [c.id for c in bible.characters]
    for kind, ids in [("角色", char_ids), ("能力", [a.id for a in bible.power_system.abilities]),
                      ("母题", [m.id for m in bible.motifs]), ("谜团", [m.id for m in bible.mysteries])]:
        for d in _dupes(ids):
            issues.append(Issue("error", where, f"{kind} id 重复：{d}"))
    if not any(c.role == "protagonist" for c in bible.characters):
        issues.append(Issue("error", where, "没有主角（role=protagonist）"))
    for a in bible.power_system.abilities:
        if a.owner not in char_ids:
            issues.append(Issue("error", where, f"能力 {a.id} 的持有者 {a.owner} 不存在"))
        for mid in (a.concealed_until, a.cost_concealed_until):
            if mid and mid not in {m.id for m in bible.mysteries}:
                issues.append(Issue("error", where, f"能力 {a.id} 的保密条件引用了不存在的谜团 {mid}"))
        if not a.cost.strip() or not a.limits.strip():
            issues.append(Issue("warn", where, f"能力 {a.id} 缺少代价或限制——没有代价的能力会导致战力膨胀"))
    for t in bible.address_book:
        for cid in (t.speaker, t.listener):
            if cid not in char_ids:
                issues.append(Issue("error", where, f"称呼表引用了不存在的角色 {cid}"))
    for c in bible.characters:
        if c.role in ("protagonist", "heroine", "rival", "support") and len(c.voice.sample_lines) < 2:
            issues.append(Issue("warn", where, f"角色 {c.id} 的示例台词少于 2 句，写手很难抓住口吻"))
    return issues


# ----------------------------------------------------------------- volume


def check_volume(bible: Bible, vol: VolumeOutline) -> list[Issue]:
    issues: list[Issue] = []
    W = f"卷{vol.volume}"
    char_ids = {c.id for c in bible.characters}
    roles = {c.id: c.role for c in bible.characters}
    ability_ids = {a.id for a in bible.power_system.abilities}
    motif_ids = {m.id for m in bible.motifs}
    mystery_ids = {m.id for m in bible.mysteries}

    numbers = [c.no for c in vol.chapters]
    n = len(numbers)
    if numbers != list(range(1, n + 1)):
        issues.append(Issue("error", W, f"章节号必须从 1 连续编号，现在是 {numbers}"))
    in_range = lambda x: 1 <= x <= n  # noqa: E731

    # structure and pacing
    if not in_range(vol.climax_chapter):
        issues.append(Issue("error", W, f"高潮章 {vol.climax_chapter} 不在 1~{n} 范围内"))
    elif vol.climax_chapter < math.ceil(n * 0.7):
        issues.append(Issue("warn", W, f"高潮章是第 {vol.climax_chapter} 章，位于全卷前 70%，后段可能拖沓"))
    if vol.chapters and in_range(vol.climax_chapter):
        top = max(c.tension for c in vol.chapters)
        if vol.chapters[vol.climax_chapter - 1].tension < top:
            issues.append(Issue("warn", W, "高潮章的紧张度不是全卷最高"))
    for i in range(n - 2):
        window = vol.chapters[i:i + 3]
        if len({c.mode for c in window}) == 1:
            issues.append(Issue("warn", W, f"第 {window[0].no}~{window[-1].no} 章连续三章都是 {window[0].mode}，节奏单调"))
        if all(c.tension >= 4 for c in window) or all(c.tension <= 2 for c in window):
            issues.append(Issue("warn", W, f"第 {window[0].no}~{window[-1].no} 章紧张度连续三章同一档，缺少张弛"))

    # chapters
    appearances: dict[str, list[int]] = {}
    motif_chapters: dict[str, list[int]] = {}
    for ch in vol.chapters:
        cw = f"{W} 第{ch.no}章"
        for cid in ch.cast:
            if cid not in char_ids:
                issues.append(Issue("error", cw, f"登场角色 {cid} 不在设定集中"))
            appearances.setdefault(cid, []).append(ch.no)
        if ch.pov not in ch.cast:
            issues.append(Issue("error", cw, f"视点人物 {ch.pov} 不在登场角色中"))
        for m in ch.motifs:
            if m not in motif_ids:
                issues.append(Issue("error", cw, f"母题 {m} 不在设定集中"))
            motif_chapters.setdefault(m, []).append(ch.no)
        if not ch.hook.strip():
            issues.append(Issue("warn" if ch.no == n else "error", cw, "章末没有引子"))

    # cast presence
    for cid, chs in appearances.items():
        if cid not in char_ids:
            continue
        if len(chs) == 1 and roles[cid] != "other":
            issues.append(Issue("warn", W, f"角色 {cid} 本卷只在第 {chs[0]} 章出场一次"))
        gap, a, b = _longest_gap(chs)
        if gap > MAX_ABSENCE and roles[cid] != "antagonist":
            issues.append(Issue("warn", W, f"角色 {cid} 在第 {a} 章到第 {b} 章之间消失了 {gap} 章（被遗忘的配角？）"))
    for c in bible.characters:
        if c.role in ("protagonist", "heroine") and c.id not in appearances:
            issues.append(Issue("error", W, f"{c.role} {c.id} 本卷完全没有出场"))

    # motifs
    for m in motif_ids:
        chs = motif_chapters.get(m, [])
        if len(chs) < 2:
            issues.append(Issue("warn", W, f"母题 {m} 本卷只出现 {len(chs)} 次，形成不了呼应"))
        elif vol.climax_chapter not in chs and n not in chs:
            issues.append(Issue("warn", W, f"母题 {m} 没有在高潮章或最终章出现"))

    # foreshadowing
    fids = [f.id for f in vol.foreshadows]
    for d in _dupes(fids):
        issues.append(Issue("error", W, f"伏笔 id 重复：{d}"))
    for f in vol.foreshadows:
        fw = f"{W} 伏笔{f.id}"
        if not in_range(f.plant):
            issues.append(Issue("error", fw, f"埋设章 {f.plant} 不存在"))
            continue
        if f.payoff is not None:
            if not in_range(f.payoff):
                issues.append(Issue("error", fw, f"回收章 {f.payoff} 不存在"))
            elif f.payoff <= f.plant:
                issues.append(Issue("error", fw, f"回收（第{f.payoff}章）不晚于埋设（第{f.plant}章）"))
            elif f.payoff - f.plant < MIN_PAYOFF_GAP:
                issues.append(Issue("warn", fw, f"埋设与回收只隔 {f.payoff - f.plant} 章，回收缺少冲击力"))
        end = f.payoff if f.payoff is not None else n
        for r in f.reinforce:
            if not (f.plant < r < end or (f.payoff is None and f.plant < r <= n)):
                issues.append(Issue("warn", fw, f"二次提醒章 {r} 不在埋设与回收之间"))
        if f.subtlety == "hidden" and f.payoff is not None and not f.reinforce and f.payoff - f.plant > 3:
            issues.append(Issue("warn", fw, "埋得很深又没有二次提醒，回收时读者可能想不起来"))

    # twists
    planted = {f.id: f.plant for f in vol.foreshadows}
    for t in vol.twists:
        tw = f"{W} 第{t.chapter}章转折"
        valid = [c for c in t.clues if c in planted and planted[c] < t.chapter]
        for c in t.clues:
            if c not in planted:
                issues.append(Issue("error", tw, f"线索 {c} 不是本卷伏笔"))
            elif planted[c] >= t.chapter:
                issues.append(Issue("error", tw, f"线索 {c} 在第 {planted[c]} 章才埋下，不早于转折"))
        if len(valid) < 2:
            issues.append(Issue("error" if not valid else "warn", tw,
                                f"只有 {len(valid)} 条有效的事前线索，转折会显得突兀（需要意外但必然）"))

    # threads
    if not any(t.kind == "main" for t in vol.threads):
        issues.append(Issue("warn", W, "没有主线（kind=main）"))
    for t in vol.threads:
        tw = f"{W} 支线{t.id}"
        bad = [x for x in t.touches if not in_range(x)]
        if bad:
            issues.append(Issue("error", tw, f"推进章节 {bad} 不存在"))
        if t.resolves is not None and (not in_range(t.resolves) or (t.touches and t.resolves < max(t.touches))):
            issues.append(Issue("error", tw, f"收束章 {t.resolves} 不存在或早于最后一次推进"))
        gap, a, b = _longest_gap(t.touches + ([t.resolves] if t.resolves else []))
        if gap > MAX_ABSENCE:
            issues.append(Issue("warn", tw, f"在第 {a} 章到第 {b} 章之间停滞了 {gap} 章"))

    # power and mysteries
    for p in vol.power_limits:
        if p.ability not in ability_ids:
            issues.append(Issue("error", W, f"战力上限引用了不存在的能力 {p.ability}"))
    for m in vol.mysteries_raised + vol.mysteries_answered:
        if m not in mystery_ids:
            issues.append(Issue("error", W, f"谜团 {m} 不在设定集中"))
    if not vol.mysteries_answered:
        issues.append(Issue("warn", W, "本卷没有解答任何谜团，读者得不到满足感"))
    if not vol.mysteries_raised:
        issues.append(Issue("warn", W, "本卷没有提出新谜团，缺少通往下一卷的引力"))
    return issues


# ---------------------------------------------------------------- chapter


def check_chapter(bible: Bible, vol: VolumeOutline, plan: ChapterPlan, earlier: list[ChapterPlan],
                  ledger: Ledger | None = None) -> list[Issue]:
    """`earlier` holds every chapter plan that precedes `plan` (any volume)."""
    issues: list[Issue] = []
    W = f"卷{plan.volume} 第{plan.chapter}章"
    char_ids = {c.id for c in bible.characters}
    abilities = {a.id: a for a in bible.power_system.abilities}
    motif_ids = {m.id for m in bible.motifs}
    sealed = {p.ability for p in vol.power_limits if p.sealed}
    outline = next((c for c in vol.chapters if c.no == plan.chapter), None)
    if plan.volume != vol.volume or outline is None:
        return [Issue("error", W, "卷纲中没有这一章")]

    nums = [s.no for s in plan.scenes]
    if nums != list(range(1, len(nums) + 1)):
        issues.append(Issue("error", W, f"场景号必须从 1 连续编号，现在是 {nums}"))

    expected_plants = {f.id for f in vol.foreshadows if f.plant == plan.chapter or plan.chapter in f.reinforce}
    expected_payoffs = {f.id for f in vol.foreshadows if f.payoff == plan.chapter}
    used_before = {a for p in earlier for s in p.scenes for a in s.abilities_used}
    new_this_volume = {a for p in earlier if p.volume == plan.volume for s in p.scenes for a in s.abilities_used}
    new_this_volume -= {a for p in earlier if p.volume < plan.volume for s in p.scenes for a in s.abilities_used}
    records = {(r.chapter, r.scene): r.digest for r in (ledger.scenes if ledger else []) if r.volume == plan.volume}

    seen_plants, seen_payoffs, seen_cast, seen_motifs = set(), set(), set(), set()
    for s in plan.scenes:
        sw = f"{W} 场景{s.no}"
        for cid in s.cast:
            if cid not in char_ids:
                issues.append(Issue("error", sw, f"角色 {cid} 不在设定集中"))
        if s.pov not in s.cast:
            issues.append(Issue("error", sw, f"视点人物 {s.pov} 不在场"))
        if not 3 <= len(s.beats) <= 10:
            issues.append(Issue("warn", sw, f"有 {len(s.beats)} 个节拍（建议 4~8）"))
        if s.emotion_start.strip() == s.emotion_end.strip():
            issues.append(Issue("warn", sw, "情绪起点和终点相同，这一场没有变化"))
        for f in s.plants:
            if f not in expected_plants:
                issues.append(Issue("error", sw, f"伏笔 {f} 没有安排在本章埋设或二次提醒"))
        for f in s.payoffs:
            if f not in expected_payoffs:
                issues.append(Issue("error", sw, f"伏笔 {f} 没有安排在本章回收"))
        for m in s.reveals:
            if m not in vol.mysteries_answered:
                issues.append(Issue("warn", sw, f"揭晓了卷纲没有计划解答的谜团 {m}"))
        for m in s.motifs:
            if m not in motif_ids:
                issues.append(Issue("error", sw, f"母题 {m} 不在设定集中"))
        for a in s.abilities_used:
            if a not in abilities:
                issues.append(Issue("error", sw, f"能力 {a} 不在设定集中（不能临时发明能力）"))
                continue
            if abilities[a].owner not in s.cast:
                issues.append(Issue("error", sw, f"能力 {a} 的持有者 {abilities[a].owner} 不在场"))
            if a in sealed:
                issues.append(Issue("error", sw, f"能力 {a} 在本卷被封印"))
            if a not in used_before and plan.chapter >= vol.climax_chapter:
                issues.append(Issue("error", sw, f"能力 {a} 第一次登场就在高潮章或之后——机械降神"))
            if a not in used_before:
                new_this_volume.add(a)
        seen_plants |= set(s.plants)
        seen_payoffs |= set(s.payoffs)
        seen_cast |= set(s.cast)
        seen_motifs |= set(s.motifs)
        if (digest := records.get((plan.chapter, s.no))) is not None:
            issues += check_drift(sw, s, digest)

    for f in sorted(expected_plants - seen_plants):
        issues.append(Issue("error", W, f"卷纲安排在本章埋设/提醒的伏笔 {f} 没有分配到任何场景"))
    for f in sorted(expected_payoffs - seen_payoffs):
        issues.append(Issue("error", W, f"卷纲安排在本章回收的伏笔 {f} 没有分配到任何场景"))
    for cid in sorted(set(outline.cast) - seen_cast):
        issues.append(Issue("warn", W, f"卷纲中的登场角色 {cid} 没有出现在任何场景"))
    for m in sorted(set(outline.motifs) - seen_motifs):
        issues.append(Issue("warn", W, f"卷纲中的母题 {m} 没有出现在任何场景"))
    if len(new_this_volume) > MAX_NEW_ABILITIES:
        issues.append(Issue("warn", W, f"本卷已有 {len(new_this_volume)} 个新能力登场：{sorted(new_this_volume)}，注意战力膨胀"))
    return issues


def check_drift(where: str, scene, digest) -> list[Issue]:
    """Compare what the writer actually produced (digest) with the scene plan."""
    issues = []
    for f in sorted(set(scene.plants) - set(digest.plants_landed)):
        issues.append(Issue("warn", where, f"正文中没有体现计划埋下的伏笔 {f}"))
    for f in sorted(set(scene.payoffs) - set(digest.payoffs_landed)):
        issues.append(Issue("warn", where, f"正文中没有完成计划的回收 {f}"))
    if digest.beats_missing:
        issues.append(Issue("warn", where, f"正文漏写了节拍 {digest.beats_missing}"))
    for e in digest.unplanned_events:
        issues.append(Issue("warn", where, f"剧情漂移：节拍外的重大事件——{e}"))
    for a in digest.abilities_shown:
        if a.ability not in scene.abilities_used:
            issues.append(Issue("warn", where, f"正文使用了计划外的能力 {a.ability}：{a.what}"))
    for o in digest.ooc:
        issues.append(Issue("warn", where, f"疑似 OOC：{o}"))
    return issues
