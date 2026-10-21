"""`lnh` command line."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv

from . import stages
from .checks import Issue, check_bible, check_chapter, check_volume
from .project import HarnessError, Project, init_project

HARNESS_ROOT = Path(__file__).resolve().parents[2]


def _print_issues(issues: list[Issue]) -> int:
    errors = [i for i in issues if i.level == "error"]
    for i in sorted(issues, key=lambda i: i.level):
        print(i)
    print(f"\n检查结果：{len(errors)} 个错误，{len(issues) - len(errors)} 个警告。")
    return 1 if errors else 0


def _feedback(value: str | None) -> str | None:
    if value and Path(value).is_file():
        return Path(value).read_text(encoding="utf-8")
    return value


def _stream(text: str) -> None:
    sys.stdout.write(text)
    sys.stdout.flush()


def check_project(project: Project) -> list[Issue]:
    bible = project.bible()
    issues = check_bible(bible)
    ledger = project.ledger()
    volumes = sorted(int(p.stem[3:]) for p in (project.root / "plan").glob("vol??.yaml"))
    plans = {(v, c): project.chapter(v, c) for v, c in project.planned_chapters()}
    for v in volumes:
        outline = project.volume(v)
        issues += check_volume(bible, outline)
        for (pv, pc), plan in plans.items():
            if pv == v:
                earlier = [p for key, p in plans.items() if key < (pv, pc)]
                issues += check_chapter(bible, outline, plan, earlier, ledger)
    return issues


def _draft_one(project: Project, v: int, c: int, s: int) -> None:
    print(f"\n──── 第{v}卷 第{c}章 场景{s} ────")
    stages.draft_scene(project, v, c, s, on_text=_stream)
    print()
    report = stages.lint_scene(project, v, c, s)
    print(f"\n[lint] {report.summary()}")
    for f in report.findings:
        print(f"  ⚠ {f}")
    drift = stages.digest_scene(project, v, c, s)
    for i in drift:
        print(f"  {i}")
    if report.findings or drift:
        print(f"  → 可以运行 `lnh revise {v} {c} {s}` 按这些意见改稿。")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="lnh", description="日式轻小说写作 harness：先大纲、再细纲、再按细纲写正文。")
    ap.add_argument("-p", "--project", default=".", help="小说项目目录（默认当前目录）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("init", help="创建新的小说项目")
    p.add_argument("dir")
    p.add_argument("--title", default="未命名")

    plan = sub.add_parser("plan", help="规划：设定集 / 卷纲 / 细纲").add_subparsers(dest="what", required=True)
    for name, args in [("bible", []), ("volume", ["volume"]), ("chapter", ["volume", "chapter"])]:
        p = plan.add_parser(name)
        for a in args:
            p.add_argument(a, type=int)
        if name == "volume":
            p.add_argument("--chapters", type=int, help="本卷章数（默认取 project.yaml）")
        p.add_argument("--feedback", help="修改意见（文字或文件路径）；文件已存在时按意见修订")
        p.add_argument("--force", action="store_true", help="忽略已有文件，从头重写")

    sub.add_parser("check", help="确定性检查：伏笔、战力、配角、母题、节奏、剧情漂移")
    p = sub.add_parser("review", help="读者预测测试 + 编辑审阅卷纲")
    p.add_argument("volume", type=int)

    for name, help_text in [("packet", "打印写手实际会看到的完整上下文（不调用模型）"),
                            ("draft", "写一个场景（随后自动 lint + 校对提取）"),
                            ("digest", "重新对一个场景做校对提取"),
                            ("lint", "只做文风检查"),
                            ("revise", "按 lint、校对和你的意见改写一个场景")]:
        p = sub.add_parser(name, help=help_text)
        for a in ("volume", "chapter", "scene"):
            p.add_argument(a, type=int)
        if name == "draft":
            p.add_argument("--force", action="store_true", help="覆盖已有正文")
        if name == "revise":
            p.add_argument("--notes", help="你的修改意见（文字或文件路径）")
    p = sub.add_parser("write", help="按细纲写完一整章（跳过已写好的场景）")
    p.add_argument("volume", type=int)
    p.add_argument("chapter", type=int)
    p.add_argument("--force", action="store_true", help="重写已有场景")
    return ap


def run(args: argparse.Namespace) -> int:
    if args.cmd == "init":
        root = init_project(Path(args.dir), args.title)
        print(f"已创建 {root}。下一步：编辑 premise.md 和 style.md，然后运行 `lnh -p {root} plan bible`。")
        return 0

    project = Project(Path(args.project))
    if args.cmd == "plan":
        fb = _feedback(args.feedback)
        if args.what == "bible":
            issues = stages.plan_bible(project, fb, args.force)
        elif args.what == "volume":
            issues = stages.plan_volume(project, args.volume, args.chapters, fb, args.force)
        else:
            issues = stages.plan_chapter(project, args.volume, args.chapter, fb, args.force)
        print("已保存。")
        return _print_issues(issues)
    if args.cmd == "check":
        return _print_issues(check_project(project))
    if args.cmd == "review":
        print(f"审阅意见已保存到 {stages.review_volume(project, args.volume)}")
        return 0

    v = args.volume
    if args.cmd == "write":
        plan = project.chapter(v, args.chapter)
        for s in plan.scenes:
            if project.scene_draft_path(v, args.chapter, s.no).exists() and not args.force:
                print(f"场景{s.no} 已有正文，跳过。")
                continue
            _draft_one(project, v, args.chapter, s.no)
        print(f"\n整章已合并到 {stages.assemble_chapter(project, v, args.chapter)}")
        return 0

    c, s = args.chapter, args.scene
    if args.cmd == "packet":
        print(stages.writer_context_preview(project, v, c, s))
    elif args.cmd == "draft":
        if project.scene_draft_path(v, c, s).exists() and not args.force:
            raise HarnessError("这个场景已有正文。要重写请加 --force，要修改请用 `lnh revise`。")
        _draft_one(project, v, c, s)
    elif args.cmd == "digest":
        _print_issues(stages.digest_scene(project, v, c, s))
    elif args.cmd == "lint":
        report = stages.lint_scene(project, v, c, s)
        print(report.summary())
        for f in report.findings:
            print(f"⚠ {f}")
    elif args.cmd == "revise":
        stages.revise_scene(project, v, c, s, _feedback(args.notes), on_text=_stream)
        print("\n\n已保存（旧版本保存为 .prev.md）。重新校对：")
        _print_issues(stages.digest_scene(project, v, c, s))
        if all(project.scene_draft_path(v, c, sc.no).exists() for sc in project.chapter(v, c).scenes):
            print(f"整章已重新合并到 {stages.assemble_chapter(project, v, c)}")
    return 0


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    load_dotenv(HARNESS_ROOT / ".env")
    try:
        sys.exit(run(build_parser().parse_args()))
    except HarnessError as exc:
        print(f"\n错误：{exc}", file=sys.stderr)
        sys.exit(2)
