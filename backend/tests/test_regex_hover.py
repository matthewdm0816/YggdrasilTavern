import pytest

from app import schemas
from app.services.prompt_config import normalize_regex_rules


def rule(**changes):
    return dict(id="hover", name="Preview", mode="hover", targets=["display"], pattern="secret", **changes)


def test_hover_mode_persists_as_display_only():
    value = normalize_regex_rules([rule()])
    assert value[0]["mode"] == "hover"
    assert schemas.RegexRule.model_validate(value[0]).targets == ["display"]


@pytest.mark.parametrize("targets", [["outgoing_prompt"], ["display", "outgoing_prompt"], ["user_input"], ["assistant_output"]])
def test_hover_rejects_non_display_targets(targets):
    value = rule()
    value["targets"] = targets
    with pytest.raises(ValueError, match="hover|display"):
        normalize_regex_rules([value])
