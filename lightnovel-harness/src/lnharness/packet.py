"""Compile the writer's context ("writer packet") for one scene.

This is the only text the prose model ever sees. It is plain natural language:
no JSON, no ids, no tool or pipeline vocabulary. It also hides what the writer
should not know yet: character secrets, mystery answers that are not revealed
in this scene, foreshadow truths before their payoff, unrevealed abilities and
every future chapter.
"""

from __future__ import annotations

from dataclasses import dataclass
from importlib import resources
from string import Template

from .checks import check_chapter
from .project import HarnessError, Project
from .schema import Bible, ChapterPlan, Character, Ledger, Scene, VolumeOutline

TAIL_CHARS = 1500
MAX_FACTS = 12

SUBTLETY_GUIDE = {
    "hidden": "让它淹没在日常描写里，不要强调；叙述者和角色都不会在意它。",
    "noticeable": "可以让视点人物稍微在意一下，但很快被别的事情带过，不要解释。",
    "obvious": "可以明确地作为一个悬念抛给读者，但不要给出答案。",
}


@dataclass
class Packet:
    system: str
    user: str


def prompt_text(name: str) -> str:
    return resources.files("lnharness").joinpath("prompts", name).read_text(encoding="utf-8")


def writer_system(project: Project) -> str:
    return Template(prompt_text("writer_system.md")).substitute(style=project.style().strip())


def _tail(text: str, limit: int = TAIL_CHARS) -> str:
    if len(text) <= limit:
        return text.strip()
    cut = text[-limit:]
    newline = cut.find("\n")
    return (cut[newline + 1:] if 0 <= newline < limit // 3 else cut).strip()


def _end(text: str) -> str:
    """Terminate a planner-written fragment with exactly one sentence-final mark."""
    text = text.strip()
    return text if text.endswith(("。", "！", "？", "…", "」", "』", "）")) else text + "。"


def _quote_list(items: list[str]) -> str:
    return "".join(f"「{x}」" for x in items)


class _Names:
    def __init__(self, bible: Bible):
        self.chars = {c.id: c for c in bible.characters}

    def __call__(self, cid: str) -> str:
        if cid not in self.chars:
            raise HarnessError(f"细纲引用了设定集中不存在的角色 {cid}，请先运行 `lnh check`。")
        return self.chars[cid].name


def _earlier_scenes(ledger: Ledger, v: int, c: int, s: int):
    return [r for r in ledger.scenes if (r.volume, r.chapter, r.scene) < (v, c, s)]


def _render_character(ch: Character) -> str:
    voice = ch.voice
    lines = [f"## {ch.name}", f"{_end(ch.profile)}{_end(ch.personality)}",
             f"- 一人称：「{voice.first_person}」", f"- 说话方式：{voice.speech_style}"]
    if voice.verbal_tics:
        lines.append(f"- 口癖：{_quote_list(voice.verbal_tics)}")
    lines.append(f"- 台词示例：{_quote_list(voice.sample_lines)}")
    lines.append(f"- 想要的东西：{ch.want}")
    lines.append(f"- 缺点：{ch.flaw}")
    lines.append(f"- 潜台词（内心真正需要、但不会说出口的）：{ch.need}")
    return "\n".join(lines)


def _address_lines(bible: Bible, ledger: Ledger, cast: list[str], name, upto) -> list[str]:
    terms = {(t.speaker, t.listener): t.term for t in bible.address_book}
    for r in upto:
        for t in r.digest.address_terms:
            terms[(t.speaker, t.listener)] = t.term
    return [f"- {name(a)}称呼{name(b)}为「{term}」" for (a, b), term in terms.items()
            if a in cast and b in cast and a != b]


def _ability_lines(bible: Bible, vol: VolumeOutline, earlier_plans: list[ChapterPlan], scene: Scene,
                   upto, name) -> list[str]:
    """`earlier_plans` must already include the scenes before this one in the current chapter."""
    shown = {a for p in earlier_plans for sc in p.scenes for a in sc.abilities_used}
    shown |= {a.ability for r in upto for a in r.digest.abilities_shown}
    revealed = {m for p in earlier_plans for sc in p.scenes for m in sc.reveals} | set(scene.reveals)
    limits = {p.ability: p for p in vol.power_limits}
    lines = []
    for ab in bible.power_system.abilities:
        if ab.owner not in scene.cast or (ab.id not in shown and ab.id not in scene.abilities_used):
            continue
        lim = limits.get(ab.id)
        usage = "本场会用到。" if ab.id in scene.abilities_used else "本场不使用。"
        sealed = "现阶段完全无法使用。" if lim and lim.sealed else ""
        if ab.concealed_until and ab.concealed_until not in revealed:
            # The reader must not learn the ability exists: no name, no cost, no planner-written cap.
            lines.append(f"- {name(ab.owner)}身上有一个读者还不知道的秘密：{_end(ab.effect)}限制：{_end(ab.limits)}"
                         f"{sealed}它只能通过旁人看不懂的异常表现出来；叙述和对话都不能点破它，也不能暗示它的代价。{usage}")
            continue
        line = f"- {name(ab.owner)}的「{ab.name}」：{_end(ab.effect)}限制：{_end(ab.limits)}{sealed}"
        if ab.cost_concealed_until and ab.cost_concealed_until not in revealed:
            line += "它的代价读者还不知道，不要写出或暗示。"
        else:
            line += f"代价：{_end(ab.cost)}"
            if lim and not lim.sealed:
                line += f"现阶段的上限：{_end(lim.rule)}"
        lines.append(line + usage)
    return lines


def _story_so_far(project: Project, vol: VolumeOutline, upto) -> str:
    parts = []
    for pv in range(1, vol.volume):
        if project.volume_path(pv).exists():
            outline = project.volume(pv)
            parts.append(f"第{pv}卷《{outline.title}》：{outline.premise}")
    titles = {c.no: c.title for c in vol.chapters}
    by_chapter: dict[int, list[str]] = {}
    for r in upto:
        if r.volume == vol.volume:
            by_chapter.setdefault(r.chapter, []).append(r.digest.summary)
    for c, summaries in sorted(by_chapter.items()):
        parts.append(f"第{c}章「{titles.get(c, '')}」：" + " ".join(summaries))
    return "\n".join(parts) if parts else "（这是故事的开头。）"


def _previous_prose(project: Project, v: int, c: int, s: int) -> str | None:
    if s > 1:
        path = project.scene_draft_path(v, c, s - 1)
    elif c > 1 and project.chapter_path(v, c - 1).exists():
        last = len(project.chapter(v, c - 1).scenes)
        path = project.scene_draft_path(v, c - 1, last)
    else:
        return None
    if not path.exists():
        raise HarnessError(f"上一场的正文 {path} 还没写。请按顺序写作，否则写手无法衔接。")
    return _tail(path.read_text(encoding="utf-8"))


def build_packet(project: Project, v: int, c: int, s: int) -> Packet:
    bible = project.bible()
    vol = project.volume(v)
    plan = project.chapter(v, c)
    if not 1 <= s <= len(plan.scenes):
        raise HarnessError(f"第{v}卷第{c}章没有场景 {s}（共 {len(plan.scenes)} 个）。")
    scene = plan.scenes[s - 1]
    ledger = project.ledger()
    upto = _earlier_scenes(ledger, v, c, s)
    name = _Names(bible)
    earlier_plans = [project.chapter(pv, pc) for pv, pc in project.planned_chapters() if (pv, pc) < (v, c)]
    errors = [i for i in check_chapter(bible, vol, plan, earlier_plans) if i.level == "error"]
    if errors:
        raise HarnessError("细纲有错误，修正后才能写作（运行 `lnh check` 查看全部）：\n" + "\n".join(map(str, errors)))
    earlier_plans.append(ChapterPlan(volume=v, chapter=c, scenes=plan.scenes[: s - 1]))
    foreshadows = {f.id: f for f in vol.foreshadows}
    mysteries = {m.id: m for m in bible.mysteries}
    motifs = {m.id: m for m in bible.motifs}
    outline = next(ch for ch in vol.chapters if ch.no == c)

    out = [f"# 作品\n《{bible.title}》——{bible.logline}\n基调：{bible.tone}"]
    # Power-system rules are planner-only: they can spoil abilities the reader has not seen yet.
    world = [bible.world.overview, *bible.world.rules]
    out.append("# 世界的常识\n" + "\n".join(f"- {w}" for w in world if w))

    out.append("# 本场登场人物\n" + "\n\n".join(_render_character(name.chars[cid]) for cid in scene.cast))
    if addr := _address_lines(bible, ledger, scene.cast, name, upto):
        out.append("# 人物之间的称呼\n" + "\n".join(addr))
    if abilities := _ability_lines(bible, vol, earlier_plans, scene, upto, name):
        out.append("# 能力与限制（必须遵守，不能超出）\n" + "\n".join(abilities))

    facts = [f for r in upto for f in r.digest.new_facts if set(f.about) & set(scene.cast)][-MAX_FACTS:]
    known = [k.learned for r in upto for k in r.digest.knowledge if k.character == scene.pov][-MAX_FACTS:]
    out.append("# 到目前为止的故事\n" + _story_so_far(project, vol, upto))
    if facts:
        out.append("# 已经确定、必须保持一致的事实\n" + "\n".join(f"- {f.text}" for f in facts))
    if known:
        out.append(f"# {name(scene.pov)}目前已经知道的事\n" + "\n".join(f"- {k}" for k in known))
    if (prev := _previous_prose(project, v, c, s)) is not None:
        out.append("# 上一场的结尾（原文，请自然衔接，不要重复）\n" + prev)

    beats = "\n".join(f"{i}. {b}" for i, b in enumerate(scene.beats, 1))
    body = [f"第{c}章「{outline.title}」的第{s}场。",
            f"视点：{name(scene.pov)}（只写{name(scene.pov)}能看到、听到、想到的东西）",
            f"地点：{scene.location}　时间：{scene.time}",
            f"在场：{'、'.join(name(x) for x in scene.cast)}",
            f"{name(scene.pov)}在这一场想要：{scene.goal}",
            f"阻碍：{scene.conflict}",
            f"结果：{scene.outcome}",
            f"情绪：从「{scene.emotion_start}」变为「{scene.emotion_end}」",
            f"按顺序写出以下情节：\n{beats}"]
    if scene.key_line:
        body.append(f"本场中要出现这句台词（可以微调措辞）：「{scene.key_line}」")
    if s == len(plan.scenes):
        body.append(f"这是本章最后一场，结尾要留下引子：{outline.hook}")
    out.append("# 本场要写的内容\n" + "\n".join(body))

    craft = []
    for fid in scene.plants:
        f = foreshadows[fid]
        if c == f.plant:
            craft.append(f"- 自然地写进这个细节：{_end(f.surface)}{SUBTLETY_GUIDE[f.subtlety]}")
        else:
            craft.append(f"- 让之前出现过的这个细节再次不经意地出现：{_end(f.surface)}不要解释它。")
    for fid in scene.payoffs:
        f = foreshadows[fid]
        craft.append(f"- 之前出现过这个细节：{_end(f.surface)}在本场揭示它真正的意义：{_end(f.truth)}"
                     f"{_end(f.payoff_note)}要让读者自然地想起最初的细节。")
    for mid in scene.reveals:
        m = mysteries[mid]
        craft.append(f"- 本场揭晓一个疑问：{m.question}——真相是：{m.answer}")
    for mid in scene.motifs:
        m = motifs[mid]
        craft.append(f"- 让「{m.image}」出现在场景里。它在故事中隐约承载着：{_end(m.meaning)}不要点明这层意味。")
    if craft:
        out.append("# 写作上的安排\n" + "\n".join(craft))

    out.append(Template(prompt_text("writer_rules.md")).substitute(
        chars=scene.target_chars, pov=name(scene.pov)).strip())
    return Packet(system=writer_system(project), user="\n\n".join(out))
