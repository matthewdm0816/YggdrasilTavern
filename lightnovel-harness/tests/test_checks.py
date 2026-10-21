from lnharness.checks import check_bible, check_chapter, check_drift, check_volume
from lnharness.schema import AbilityShown, Digest

from conftest import make_bible, make_ch1, make_ch2, make_volume, scene


def messages(issues, level=None):
    return [i.message for i in issues if level is None or i.level == level]


def test_fixture_is_clean():
    bible, vol = make_bible(), make_volume()
    assert check_bible(bible) == []
    assert check_volume(bible, vol) == []
    assert check_chapter(bible, vol, make_ch1(), []) == []
    assert check_chapter(bible, vol, make_ch2(), [make_ch1()]) == []


def test_ability_without_cost_is_flagged():
    bible = make_bible()
    bible.power_system.abilities[0].cost = ""
    assert any("代价" in m for m in messages(check_bible(bible), "warn"))


def test_payoff_must_follow_plant():
    vol = make_volume()
    vol.foreshadows[0].payoff = 1
    assert any("不晚于埋设" in m for m in messages(check_volume(make_bible(), vol), "error"))


def test_payoff_too_close_is_warned():
    vol = make_volume()
    vol.foreshadows[0].payoff = 2
    assert any("冲击力" in m for m in messages(check_volume(make_bible(), vol), "warn"))


def test_twist_needs_clues_planted_before_it():
    vol = make_volume()
    vol.foreshadows[1].plant = 5
    vol.foreshadows[1].reinforce = []
    vol.foreshadows[1].payoff = None
    errors = messages(check_volume(make_bible(), vol), "error")
    assert any("不早于转折" in m for m in errors)


def test_forgotten_character_and_monotone_pacing():
    vol = make_volume()
    for ch in vol.chapters[1:5]:
        ch.cast = [c for c in ch.cast if c != "kenta"]
    for ch in vol.chapters[1:4]:
        ch.mode = "event"
    warns = messages(check_volume(make_bible(), vol), "warn")
    assert any("kenta" in m and "消失" in m for m in warns)
    assert any("连续三章" in m for m in warns)


def test_early_climax_is_warned():
    vol = make_volume()
    vol.climax_chapter = 2
    assert any("前 70%" in m for m in messages(check_volume(make_bible(), vol), "warn"))


def test_scheduled_foreshadow_must_be_assigned_to_a_scene():
    ch1 = make_ch1()
    ch1.scenes[0].plants = []
    errors = messages(check_chapter(make_bible(), make_volume(), ch1, []), "error")
    assert any("F1" in m and "没有分配" in m for m in errors)


def test_foreshadow_used_in_wrong_chapter():
    ch1 = make_ch1()
    ch1.scenes[1].payoffs = ["F1"]
    errors = messages(check_chapter(make_bible(), make_volume(), ch1, []), "error")
    assert any("没有安排在本章回收" in m for m in errors)


def test_power_creep_rules():
    bible, vol = make_bible(), make_volume()
    ch2 = make_ch2()
    ch2.scenes[0].abilities_used = ["loop", "rewind_week", "time_stop"]
    errors = messages(check_chapter(bible, vol, ch2, [make_ch1()]), "error")
    assert any("time_stop" in m and "不能临时发明" in m for m in errors)
    assert any("rewind_week" in m and "封印" in m for m in errors)


def test_new_ability_in_climax_is_deus_ex_machina():
    bible, vol = make_bible(), make_volume()
    plan = make_ch2()
    plan.chapter = 5
    plan.scenes = [scene(1, ["hero", "mio", "kaichou"], payoffs=["F1", "F2"], abilities_used=["loop"])]
    errors = messages(check_chapter(bible, vol, plan, [make_ch1()]), "error")
    assert any("机械降神" in m for m in errors)


def test_drift_between_plan_and_prose():
    plan = make_ch1().scenes[0]
    digest = Digest(summary="摘要", appearances=["hero", "mio"], new_facts=[],
                    abilities_shown=[AbilityShown(ability="loop", what="回到了早上")],
                    beats_missing=[3], unplanned_events=["澪当场坦白了循环"])
    msgs = messages(check_drift("场景1", plan, digest))
    assert any("F1" in m for m in msgs)
    assert any("节拍 [3]" in m for m in msgs)
    assert any("剧情漂移" in m for m in msgs)
    assert any("计划外的能力 loop" in m for m in msgs)
