import re

import pytest

from lnharness.packet import build_packet
from lnharness.project import HarnessError, save_model
from lnharness.schema import AddressTerm, Digest, Fact, SceneRecord

from conftest import ANSWER, F1_TRUTH, SECRET, make_ch1, make_volume, scene


def test_packet_is_plain_language_without_ids_or_hidden_knowledge(project):
    packet = build_packet(project, 1, 1, 1)
    text = packet.system + packet.user
    # what the writer needs
    assert "相泽悠真" in text and "天野澪" in text
    assert "晴天里澪带着一把蓝色的雨伞" in text          # foreshadow surface
    assert "节拍1-1" in packet.user and "今天会下雨哦" in packet.user
    assert "「天野同学」" in packet.user                  # address book
    # nothing structural or tool-like
    for token in ["F1", "M1", "hero", "mio", "umbrella", "loop", "{", "}", "JSON", "YAML", "id", "工具"]:
        assert token not in text, token
    assert not re.search(r"v\d+c\d+", text)
    # nothing the writer must not know yet
    assert SECRET not in text
    assert ANSWER not in text
    assert F1_TRUTH not in text
    assert "回到当天早上七点" not in text                 # ability not yet shown and unused here
    assert "循环只从早上七点开始" not in text             # power-system rules are planner-only
    assert "第2章梗概" not in text and "第5章标题" not in text  # no future chapters


def test_style_comments_do_not_reach_the_writer(project):
    assert "<!--" not in build_packet(project, 1, 1, 1).system


def test_previous_scene_must_exist_and_its_tail_is_included(project):
    with pytest.raises(HarnessError, match="还没写"):
        build_packet(project, 1, 1, 2)
    path = project.scene_draft_path(1, 1, 1)
    path.parent.mkdir(parents=True)
    path.write_text("最早的一句。\n" + "中间。" * 600 + "\n最后一句是雨伞。\n", encoding="utf-8")
    user = build_packet(project, 1, 1, 2).user
    assert "最后一句是雨伞。" in user
    assert "最早的一句。" not in user                      # only the tail


def test_ledger_feeds_story_so_far_facts_and_address_changes(project):
    digest = Digest(summary="悠真注意到澪的雨伞。", appearances=["hero", "mio"],
                    new_facts=[Fact(about=["mio"], text="澪住在钟楼附近")],
                    address_terms=[AddressTerm(speaker="hero", listener="mio", term="澪")])
    project.record_scene(SceneRecord(volume=1, chapter=1, scene=1, digest=digest))
    path = project.scene_draft_path(1, 1, 1)
    path.parent.mkdir(parents=True)
    path.write_text("正文。\n", encoding="utf-8")
    user = build_packet(project, 1, 1, 2).user
    assert "悠真注意到澪的雨伞。" in user
    assert "澪住在钟楼附近" in user
    assert "称呼天野澪为「澪」" in user


def test_payoff_scene_reveals_truth_and_shown_ability(project):
    ch5 = make_ch1()
    ch5.chapter = 5
    ch5.scenes = [scene(1, ["hero", "mio", "kaichou"], payoffs=["F1", "F2"], reveals=["M1"])]
    save_model(project.chapter_path(1, 5), ch5)
    for c in (1, 2):
        for s in (1, 2):
            p = project.scene_draft_path(1, c, s)
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("正文。\n", encoding="utf-8")
    user = build_packet(project, 1, 5, 1).user
    assert F1_TRUTH in user and ANSWER in user
    assert "「重来」" in user and "一天最多一次" in user     # shown in ch2, limited by the volume cap
    assert "本场不使用" in user
    assert "倒带" not in user                               # sealed and never shown


def test_concealed_ability_is_hinted_until_its_mystery_is_revealed(project):
    bible = project.bible()
    bible.power_system.abilities[0].concealed_until = "M1"
    bible.power_system.abilities[0].cost_concealed_until = "M2"
    save_model(project.bible_path, bible)
    for s in (1, 2):
        p = project.scene_draft_path(1, 1, s)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("正文。\n", encoding="utf-8")
    hidden = build_packet(project, 1, 2, 1).user
    assert "读者还不知道的秘密" in hidden and "回到当天早上七点" in hidden
    assert "「重来」" not in hidden and "每次失去一段记忆" not in hidden and "一天最多一次" not in hidden

    ch2 = project.chapter(1, 2)
    ch2.scenes[0].reveals = ["M1"]
    vol = make_volume()
    vol.mysteries_answered = ["M1", "M2"]
    save_model(project.volume_path(1), vol)
    save_model(project.chapter_path(1, 2), ch2)
    known = build_packet(project, 1, 2, 1).user
    assert "「重来」" in known and "它的代价读者还不知道" in known
    assert "每次失去一段记忆" not in known


def test_packet_refuses_plans_with_errors(project):
    vol = make_volume()
    vol.foreshadows[0].plant = 2
    save_model(project.volume_path(1), vol)
    with pytest.raises(HarnessError, match="细纲有错误"):
        build_packet(project, 1, 1, 1)
