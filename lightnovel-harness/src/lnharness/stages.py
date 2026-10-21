"""Pipeline stages.

Control plane (planner / analyst): structured JSON, validated by pydantic and
then by the deterministic checks.
Writing plane (writer): one plain-text call built only from the writer packet.
"""

from __future__ import annotations

from string import Template

from .checks import Issue, check_bible, check_chapter, check_drift, check_volume
from .lint import LintReport, lint_prose
from .llm import OnText, complete, complete_json
from .packet import build_packet, prompt_text
from .project import HarnessError, Project, dump_yaml, save_model
from .schema import Bible, ChapterPlan, Digest, SceneRecord, VolumeOutline


def _guard_overwrite(path, feedback: str | None, force: bool) -> None:
    if path.exists() and not (feedback or force):
        raise HarnessError(f"{path} 已存在。要按意见修订请加 --feedback，要从头重写请加 --force。")


def _revision(path, feedback: str | None, force: bool) -> str:
    if not feedback:
        return ""
    if path.exists() and not force:
        return (f"\n# 修订\n下面是上一版，请按修改意见修订；没有被要求修改的部分保持不变。\n"
                f"## 上一版\n{path.read_text(encoding='utf-8')}\n## 修改意见\n{feedback}\n")
    return f"\n# 作者的补充要求\n{feedback}\n"


def _yaml(obj) -> str:
    return dump_yaml(obj.model_dump(mode="json"))


# ------------------------------------------------------------------ planning


def plan_bible(project: Project, feedback: str | None = None, force: bool = False) -> list[Issue]:
    path = project.bible_path
    _guard_overwrite(path, feedback, force)
    user = Template(prompt_text("plan_bible.md")).substitute(
        premise=project.premise(), revision=_revision(path, feedback, force))
    bible = complete_json(project, "planner", "plan-bible", prompt_text("plan_system.md"), user, Bible)
    save_model(path, bible)
    return check_bible(bible)


def _previous_volumes(project: Project, v: int) -> str:
    parts = []
    for pv in range(1, v):
        outline = project.volume(pv)
        open_threads = [f"{f.id}：{f.surface}（真相：{f.truth}）" for f in outline.foreshadows if f.payoff is None]
        parts.append(f"## 第{pv}卷《{outline.title}》\n{outline.premise}\n结局：{outline.structure.ketsu}\n"
                     f"留待回收的伏笔：{'；'.join(open_threads) or '无'}")
    return "\n".join(parts) or "（这是第一卷。）"


def plan_volume(project: Project, v: int, chapters: int | None = None, feedback: str | None = None,
                force: bool = False) -> list[Issue]:
    path = project.volume_path(v)
    _guard_overwrite(path, feedback, force)
    bible = project.bible()
    user = Template(prompt_text("plan_volume.md")).substitute(
        volume=v, chapters=chapters or project.config.targets.chapters_per_volume, bible=_yaml(bible),
        previous=_previous_volumes(project, v), revision=_revision(path, feedback, force))
    outline = complete_json(project, "planner", f"plan-vol{v}", prompt_text("plan_system.md"), user, VolumeOutline)
    outline.volume = v
    save_model(path, outline)
    return check_volume(bible, outline)


def _story_digest(project: Project, upto: tuple[int, int]) -> str:
    lines = [f"第{r.volume}卷第{r.chapter}章第{r.scene}场：{r.digest.summary}"
             for r in project.ledger().scenes if (r.volume, r.chapter) < upto]
    return "\n".join(lines) or "（还没有写任何正文。）"


def _earlier_plans(project: Project, v: int, c: int) -> list[ChapterPlan]:
    return [project.chapter(pv, pc) for pv, pc in project.planned_chapters() if (pv, pc) < (v, c)]


def plan_chapter(project: Project, v: int, c: int, feedback: str | None = None,
                 force: bool = False) -> list[Issue]:
    path = project.chapter_path(v, c)
    _guard_overwrite(path, feedback, force)
    bible, outline = project.bible(), project.volume(v)
    if not any(ch.no == c for ch in outline.chapters):
        raise HarnessError(f"第{v}卷卷纲中没有第{c}章。")
    tasks = []
    for f in outline.foreshadows:
        if f.plant == c:
            tasks.append(f"- {f.id}（埋设，{f.subtlety}）：表面细节「{f.surface}」，真相「{f.truth}」")
        if c in f.reinforce:
            tasks.append(f"- {f.id}（二次提醒）：表面细节「{f.surface}」")
        if f.payoff == c:
            tasks.append(f"- {f.id}（回收）：表面细节「{f.surface}」，真相「{f.truth}」，回收方式「{f.payoff_note}」")
    earlier = _earlier_plans(project, v, c)
    seen = sorted({a for p in earlier for s in p.scenes for a in s.abilities_used})
    user = Template(prompt_text("plan_chapter.md")).substitute(
        volume=v, chapter=c, bible=_yaml(bible), outline=_yaml(outline),
        story_so_far=_story_digest(project, (v, c)), foreshadow_tasks="\n".join(tasks) or "（本章没有伏笔任务。）",
        abilities_seen="、".join(seen) or "（还没有能力登场。）",
        scene_chars=project.config.targets.scene_chars, revision=_revision(path, feedback, force))
    plan = complete_json(project, "planner", f"plan-vol{v}-ch{c}", prompt_text("plan_system.md"), user, ChapterPlan)
    plan.volume, plan.chapter = v, c
    save_model(path, plan)
    return check_chapter(bible, outline, plan, earlier, project.ledger())


# ------------------------------------------------------------------- writing


def draft_scene(project: Project, v: int, c: int, s: int, on_text: OnText) -> str:
    packet = build_packet(project, v, c, s)
    text = complete(project, "writer", f"draft-v{v}c{c}s{s}", packet.system, packet.user, on_text=on_text).strip()
    path = project.scene_draft_path(v, c, s)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text + "\n", encoding="utf-8")
    return text


def lint_scene(project: Project, v: int, c: int, s: int) -> LintReport:
    scene = project.chapter(v, c).scenes[s - 1]
    return lint_prose(project.scene_draft(v, c, s), scene.target_chars, project.config.lint)


def digest_scene(project: Project, v: int, c: int, s: int) -> list[Issue]:
    bible, outline = project.bible(), project.volume(v)
    scene = project.chapter(v, c).scenes[s - 1]
    foreshadows = {f.id: f for f in outline.foreshadows}
    user = Template(prompt_text("digest.md")).substitute(
        characters="\n".join(f"- {ch.id}：{ch.name}" for ch in bible.characters),
        abilities="\n".join(f"- {a.id}：{a.name}（{a.effect}）" for a in bible.power_system.abilities),
        addresses="\n".join(f"- {t.speaker} → {t.listener}：{t.term}" for t in bible.address_book),
        goal=scene.goal, conflict=scene.conflict, outcome=scene.outcome,
        beats="\n".join(f"{i}. {b}" for i, b in enumerate(scene.beats, 1)),
        plants="\n".join(f"- {f}：{foreshadows[f].surface}" for f in scene.plants) or "（无）",
        payoffs="\n".join(f"- {f}：{foreshadows[f].surface} → {foreshadows[f].truth}" for f in scene.payoffs) or "（无）",
        abilities_used="、".join(scene.abilities_used) or "（无）",
        prose=project.scene_draft(v, c, s))
    digest = complete_json(project, "analyst", f"digest-v{v}c{c}s{s}", "你是严谨的小说校对。", user, Digest)
    project.record_scene(SceneRecord(volume=v, chapter=c, scene=s, digest=digest))
    return check_drift(f"卷{v} 第{c}章 场景{s}", scene, digest)


def revision_notes(project: Project, v: int, c: int, s: int, extra: str | None) -> list[str]:
    """Editor notes in plain language (no ids), assembled from lint, the digest and the author."""
    scene = project.chapter(v, c).scenes[s - 1]
    foreshadows = {f.id: f for f in project.volume(v).foreshadows}
    notes = list(lint_scene(project, v, c, s).findings)
    record = next((r for r in project.ledger().scenes if (r.volume, r.chapter, r.scene) == (v, c, s)), None)
    if record is not None:
        d = record.digest
        notes += [f"没有写出这个细节：{foreshadows[f].surface}" for f in set(scene.plants) - set(d.plants_landed)]
        notes += [f"没有完成这处回收：{foreshadows[f].surface} → {foreshadows[f].truth}"
                  for f in set(scene.payoffs) - set(d.payoffs_landed)]
        notes += [f"漏写了情节：{scene.beats[i - 1]}" for i in d.beats_missing if 1 <= i <= len(scene.beats)]
        notes += [f"删掉或弱化节拍之外的事件：{e}" for e in d.unplanned_events]
        notes += [f"角色言行不符合设定：{o}" for o in d.ooc]
    if extra:
        notes.append(extra)
    return notes


def revise_scene(project: Project, v: int, c: int, s: int, extra: str | None, on_text: OnText) -> str:
    notes = revision_notes(project, v, c, s, extra)
    if not notes:
        raise HarnessError("没有修改意见：lint 和校对都没有发现问题。可以用 --notes 写下你的意见。")
    packet = build_packet(project, v, c, s)
    path = project.scene_draft_path(v, c, s)
    draft = project.scene_draft(v, c, s)
    user = (f"{packet.user}\n\n# 初稿\n{draft}\n\n# 编辑的修改意见\n" + "\n".join(f"- {n}" for n in notes) +
            "\n\n# 改稿要求\n根据修改意见改写这一场，输出修改后的完整正文。保留初稿中好的部分；不要解释改了什么。")
    text = complete(project, "writer", f"revise-v{v}c{c}s{s}", packet.system, user, on_text=on_text).strip()
    path.with_suffix(".prev.md").write_text(draft, encoding="utf-8")
    path.write_text(text + "\n", encoding="utf-8")
    return text


def assemble_chapter(project: Project, v: int, c: int) -> str:
    plan = project.chapter(v, c)
    title = next(ch.title for ch in project.volume(v).chapters if ch.no == c)
    sep = f"\n\n{project.config.targets.scene_separator}\n\n"
    body = sep.join(project.scene_draft(v, c, s.no).strip() for s in plan.scenes)
    path = project.chapter_draft_path(v, c)
    path.write_text(f"# 第{c}章　{title}\n\n{body}\n", encoding="utf-8")
    return str(path)


# -------------------------------------------------------------------- review


def review_volume(project: Project, v: int) -> str:
    bible, outline = project.bible(), project.volume(v)
    predictions = []
    for t in sorted(outline.twists, key=lambda t: t.chapter):
        before = [ch for ch in outline.chapters if ch.no < t.chapter]
        if not before:
            continue
        synopsis = "\n".join(f"第{ch.no}章「{ch.title}」：{ch.summary}" for ch in before)
        guess = complete(project, "analyst", f"review-vol{v}-predict-ch{t.chapter}", "你是一名轻小说读者。",
                         Template(prompt_text("review_reader.md")).substitute(
                             known=len(before), synopsis=synopsis, next=t.chapter))
        predictions.append(f"## 第{t.chapter}章的转折\n计划：{t.what}\n读者的预测：\n{guess.strip()}")
    issues = check_volume(bible, outline)
    user = Template(prompt_text("review_editor.md")).substitute(
        bible=_yaml(bible), outline=_yaml(outline), predictions="\n\n".join(predictions) or "（没有可测试的转折。）",
        issues="\n".join(map(str, issues)) or "（无）")
    report = complete(project, "planner", f"review-vol{v}", prompt_text("plan_system.md"), user)
    path = project.volume_path(v).with_suffix(".review.md")
    path.write_text(report.strip() + "\n", encoding="utf-8")
    return str(path)


def writer_context_preview(project: Project, v: int, c: int, s: int) -> str:
    packet = build_packet(project, v, c, s)
    return f"======== system ========\n{packet.system}\n\n======== user ========\n{packet.user}\n"

