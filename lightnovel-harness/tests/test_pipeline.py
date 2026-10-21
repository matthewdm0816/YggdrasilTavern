import json

import pytest

from lnharness import llm, stages
from lnharness.project import HarnessError
from lnharness.schema import Bible, Digest

from conftest import make_bible


class FakeProvider:
    def __init__(self, *responses: str):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, provider, role_cfg, session_id, system, user, json_mode, on_text):
        self.calls.append(dict(model=role_cfg.model, session_id=session_id, system=system, user=user,
                               json_mode=json_mode, header=provider.session_header))
        text = self.responses.pop(0)
        on_text(text)
        return text, {"fake": True}


@pytest.fixture
def fake(monkeypatch):
    def install(*responses):
        provider = FakeProvider(*responses)
        monkeypatch.setattr(llm, "_call_provider", provider)
        return provider
    return install


def test_json_repair_loop_and_logs(project, fake):
    good = make_bible().model_dump_json()
    provider = fake("这不是 JSON", f"```json\n{good}\n```")
    bible = llm.complete_json(project, "planner", "t", "sys", "user", Bible)
    assert bible.title == "六月十四日的雨伞"
    assert "校验错误" in provider.calls[1]["user"] and "这不是 JSON" in provider.calls[1]["user"]
    assert all(c["json_mode"] for c in provider.calls)
    assert len(list(project.log_dir.glob("*-planner-t*.yaml"))) == 2


def test_json_failure_is_loud(project, fake):
    fake("坏", "坏", "坏")
    with pytest.raises(HarnessError, match="仍不合法"):
        llm.complete_json(project, "planner", "t", "sys", "user", Bible)


def test_plan_bible_saves_and_guards_overwrite(project, fake):
    fake(make_bible().model_dump_json())
    assert stages.plan_bible(project, force=True) == []
    with pytest.raises(HarnessError, match="已存在"):
        stages.plan_bible(project)


def test_draft_digest_revise_cycle(project, fake):
    prose = "「早安。」\n澪把伞靠在桌边。\n「今天会下雨哦。」\n我看向窗外。\n"
    digest = Digest(summary="悠真和澪聊天。", appearances=["hero", "mio"], new_facts=[], plants_landed=[],
                    beats_missing=[2])
    provider = fake(prose, digest.model_dump_json(), "改好的正文。\n")

    stages.draft_scene(project, 1, 1, 1, on_text=lambda _: None)
    writer_call = provider.calls[0]
    assert writer_call["model"] == "gemini-4-argon-contributor"
    assert writer_call["json_mode"] is False
    assert writer_call["session_id"] == "lnh-test" and writer_call["header"] == "x-opencode-session"
    assert "JSON" not in writer_call["system"] + writer_call["user"]
    assert project.scene_draft(1, 1, 1) == prose

    drift = stages.digest_scene(project, 1, 1, 1)
    assert provider.calls[1]["model"] == "deepseek-v4.1-flash"
    assert any("F1" in i.message for i in drift)
    assert project.ledger().scenes[0].digest.summary == "悠真和澪聊天。"

    stages.revise_scene(project, 1, 1, 1, "让澪更调皮一点", on_text=lambda _: None)
    revise_user = provider.calls[2]["user"]
    assert "没有写出这个细节：晴天里澪带着一把蓝色的雨伞" in revise_user
    assert "漏写了情节：节拍1-2" in revise_user
    assert "让澪更调皮一点" in revise_user
    assert "F1" not in revise_user and json.dumps("F1") not in revise_user
    assert project.scene_draft(1, 1, 1) == "改好的正文。\n"
    assert project.scene_draft_path(1, 1, 1).with_suffix(".prev.md").read_text(encoding="utf-8") == prose
