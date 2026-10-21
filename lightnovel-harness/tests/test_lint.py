from lnharness.lint import lint_prose
from lnharness.project import LintConfig


def test_clean_prose_has_no_findings():
    text = "「早安。」\n澪把伞靠在桌边。\n「今天会下雨哦。」\n我看了一眼窗外。天空蓝得过分。\n「骗人的吧。」\n"
    report = lint_prose(text, target_chars=len(text.replace("\n", "")))
    assert report.findings == []
    assert 0.3 < report.dialogue_ratio < 0.8


def test_cliches_density_meta_and_endings():
    text = ("她的嘴角勾起一抹弧度，仿佛看穿了一切，仿佛早就知道，仿佛什么都明白。\n"
            "「这是第一个节拍。」\n"
            "或许，这就是青春吧。\n")
    findings = " ".join(lint_prose(text, target_chars=60, config=LintConfig(banned=["青春吧"])).findings)
    assert "嘴角勾起" in findings
    assert "「仿佛」出现 3 次" in findings
    assert "写作说明" in findings
    assert "总结或感悟" in findings
    assert "青春吧" in findings


def test_repetition_long_paragraphs_and_length():
    text = "他推开天台的铁门走了出去。" * 4 + "风很大" * 80
    findings = " ".join(lint_prose(text, target_chars=3000).findings)
    assert "重复了 4 次" in findings
    assert "超过 220 字" in findings
    assert "目标约 3000" in findings
    assert "叙述过多" in findings
