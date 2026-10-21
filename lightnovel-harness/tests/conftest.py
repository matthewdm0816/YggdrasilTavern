from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from lnharness.project import TEMPLATE_DIR, Project, save_model
from lnharness.schema import (Ability, AddressTerm, Bible, ChapterOutline, ChapterPlan, Character, Foreshadow,
                              Location, Motif, Mystery, PowerLimit, PowerSystem, Scene, Structure, Thread, Twist,
                              Voice, VolumeOutline, World)

SECRET = "她已经把六月十四日重复了四十七次"
ANSWER = "澪被困在时间循环里"
F1_TRUTH = "她早就经历过这场雨"


def character(cid, name, role, first_person, secret=""):
    return Character(
        id=cid, name=name, role=role, profile=f"{name}的外貌", personality=f"{name}的性格",
        want=f"{name}想要的", need=f"{name}需要的", flaw=f"{name}的缺点", secret=secret, arc=f"{name}的成长",
        voice=Voice(first_person=first_person, speech_style=f"{name}的说话方式", verbal_tics=[f"{name}口癖"],
                    sample_lines=[f"{name}台词一", f"{name}台词二"]))


def make_bible() -> Bible:
    return Bible(
        title="六月十四日的雨伞", logline="同桌好像每天都在重来同一天", genre_tags=["校园", "恋爱", "时间循环"],
        tone="轻快中带一点寂寞", theme="被遗忘的一天还有意义吗？", series_arc="循环的真相逐步揭开",
        world=World(overview="普通的高中", rules=["学校有一座旧钟楼"], locations=[Location(name="教室", description="二楼")]),
        power_system=PowerSystem(
            overview="只有澪能回到早上", rules=["循环只从早上七点开始"],
            abilities=[
                Ability(id="loop", owner="mio", name="重来", effect="回到当天早上七点",
                        limits="一天最多三次", cost="每次失去一段记忆"),
                Ability(id="rewind_week", owner="mio", name="倒带", effect="回到一周前",
                        limits="只能用一次", cost="失去所有关于主角的记忆"),
            ]),
        characters=[character("hero", "相泽悠真", "protagonist", "我"),
                    character("mio", "天野澪", "heroine", "我", secret=SECRET),
                    character("kenta", "大森健太", "support", "俺"),
                    character("kaichou", "白鸟丽华", "rival", "本小姐")],
        address_book=[AddressTerm(speaker="hero", listener="mio", term="天野同学"),
                      AddressTerm(speaker="mio", listener="hero", term="相泽君")],
        mysteries=[Mystery(id="M1", question="澪为什么总能预知小事？", answer=ANSWER),
                   Mystery(id="M2", question="钟楼为什么停了？", answer="钟楼是循环的锚点")],
        motifs=[Motif(id="umbrella", image="蓝色的雨伞", meaning="提前准备好的温柔", evolution="从隐瞒到坦白")],
    )


def chapter(no, mode, tension, cast, motifs=(), hook="引子"):
    return ChapterOutline(no=no, title=f"第{no}章标题", pov="hero", function="作用", mode=mode, tension=tension,
                          summary=f"第{no}章梗概", cast=list(cast), motifs=list(motifs), hook=hook)


def make_volume() -> VolumeOutline:
    return VolumeOutline(
        volume=1, title="第一卷", premise="雨天的同桌", theme_angle="角度",
        structure=Structure(ki="起", sho="承", ten="转", ketsu="结"), climax_chapter=5,
        mysteries_raised=["M2"], mysteries_answered=["M1"],
        power_limits=[PowerLimit(ability="loop", rule="一天最多一次"),
                      PowerLimit(ability="rewind_week", rule="不能用", sealed=True)],
        foreshadows=[
            Foreshadow(id="F1", surface="晴天里澪带着一把蓝色的雨伞", truth=F1_TRUTH, plant=1, payoff=5,
                       payoff_note="雨落下时主角想起那把伞", subtlety="noticeable"),
            Foreshadow(id="F2", surface="澪对钟声毫无反应", truth="她听过太多次", plant=2, reinforce=[3], payoff=5,
                       payoff_note="钟声与循环同步", subtlety="hidden"),
        ],
        twists=[Twist(chapter=5, what="澪在循环", why_inevitable="伞和钟声", clues=["F1", "F2"])],
        threads=[Thread(id="T1", name="循环之谜", kind="main", description="主线", touches=[1, 2, 3, 4, 5], resolves=6),
                 Thread(id="T2", name="两人的距离", kind="romance", description="恋爱", touches=[1, 3, 5], resolves=6)],
        chapters=[chapter(1, "daily", 2, ["hero", "mio", "kenta"], ["umbrella"]),
                  chapter(2, "comedy", 2, ["hero", "mio", "kenta", "kaichou"]),
                  chapter(3, "mystery", 3, ["hero", "mio", "kaichou"], ["umbrella"]),
                  chapter(4, "event", 4, ["hero", "mio", "kenta", "kaichou"]),
                  chapter(5, "event", 5, ["hero", "mio", "kaichou"], ["umbrella"]),
                  chapter(6, "romance", 3, ["hero", "mio", "kenta"])],
    )


def scene(no, cast, **kw):
    base = dict(no=no, pov="hero", location="教室", time="早上", cast=list(cast), goal="目标", conflict="阻碍",
                outcome="结果", emotion_start="平静", emotion_end="困惑",
                beats=[f"节拍{no}-1", f"节拍{no}-2", f"节拍{no}-3", f"节拍{no}-4"], target_chars=1000)
    base.update(kw)
    return Scene(**base)


def make_ch1() -> ChapterPlan:
    return ChapterPlan(volume=1, chapter=1, scenes=[
        scene(1, ["hero", "mio"], plants=["F1"], motifs=["umbrella"], key_line="今天会下雨哦"),
        scene(2, ["hero", "mio", "kenta"]),
    ])


def make_ch2() -> ChapterPlan:
    return ChapterPlan(volume=1, chapter=2, scenes=[
        scene(1, ["hero", "mio", "kaichou"], plants=["F2"], abilities_used=["loop"]),
        scene(2, ["hero", "kenta"]),
    ])


@pytest.fixture
def project_dir(tmp_path: Path) -> Path:
    root = tmp_path / "novel"
    shutil.copytree(TEMPLATE_DIR, root)
    cfg = (root / "project.yaml").read_text(encoding="utf-8")
    (root / "project.yaml").write_text(cfg.replace("__TITLE__", "测试").replace("__SESSION_ID__", "lnh-test"),
                                       encoding="utf-8")
    save_model(root / "bible.yaml", make_bible())
    save_model(root / "plan" / "vol01.yaml", make_volume())
    save_model(root / "plan" / "vol01" / "ch01.yaml", make_ch1())
    save_model(root / "plan" / "vol01" / "ch02.yaml", make_ch2())
    return root


@pytest.fixture
def project(project_dir: Path) -> Project:
    return Project(project_dir)
