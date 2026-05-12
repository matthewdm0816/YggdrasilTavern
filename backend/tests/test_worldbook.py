from app.models import Message
from app.services.prompt_builder import LoreCandidate, activate_lore, expand_macros


def msg(content: str) -> Message:
    return Message(session_id="s1", role="user", speaker="User", content=content, sort_order=1)


def test_worldbook_activation_supports_plain_regex_secondary_constant_and_budget():
    messages = [msg("The moon gate opens near the citadel.")]
    candidates = [
        LoreCandidate(id="constant", worldbook_id="w", keys=[], secondary_keys=[], content="Always on.", constant=True, order=1),
        LoreCandidate(id="plain", worldbook_id="w", keys=["moon gate"], secondary_keys=[], content="Moon gates fold space.", order=2),
        LoreCandidate(id="regex", worldbook_id="w", keys=["/citadel/i"], secondary_keys=[], content="The citadel is old.", order=3),
        LoreCandidate(
            id="secondary",
            worldbook_id="w",
            keys=["moon"],
            secondary_keys=["citadel"],
            content="The citadel watches the moon.",
            selective=True,
            order=4,
        ),
        LoreCandidate(id="over-budget", worldbook_id="w", keys=["moon"], secondary_keys=[], content="x" * 100, order=5),
    ]
    activated = activate_lore(candidates, messages, scan_depth=8, budget=90)
    assert [item.id for item in activated] == ["constant", "plain", "regex", "secondary"]


def test_macro_expansion_handles_original_and_greetings():
    class Character:
        name = "Luna"
        description = "desc"
        personality = "kind"
        scenario = "night"
        first_mes = "hello"
        alternate_greetings = ["alt"]

    text = "{{original}} {{char}} {{user}} {{charFirstMessage}} {{charFirstMessage::1}}"
    assert expand_macros(text, Character(), "Ada", "base") == "base Luna Ada hello alt"
