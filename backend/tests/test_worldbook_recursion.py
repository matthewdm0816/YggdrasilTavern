from dataclasses import replace

import pytest
from sqlalchemy.orm import Session

from app import models
from app.database import Base, create_database_engine
from app.services import prompt_builder as pb
from app.services.tree import create_message, create_swipe, select_message


@pytest.fixture(autouse=True)
def deterministic_tokens(monkeypatch):
    monkeypatch.setattr(pb, "count_text_tokens", lambda text, model=None: len(text))


def entry(name, key, content, **kwargs):
    return pb.LoreCandidate(id=name, worldbook_id=kwargs.pop("worldbook_id", "book"),
                            keys=[key] if key else [], secondary_keys=kwargs.pop("secondary_keys", []),
                            content=content, **kwargs)


def message(content):
    return pb.PromptMessage(id="m", role="user", speaker="User", content=content)


def book(name, entries, **kwargs):
    return pb.LoadedWorldBook(id=name, candidates=tuple(entries), scan_depth=kwargs.pop("scan_depth", 8),
                             token_budget=kwargs.pop("token_budget", 4000),
                             recursive_scanning=kwargs.pop("recursive_scanning", True), **kwargs)


def chain():
    return [entry("a", "start", "beta"), entry("b", "beta", "gamma"), entry("c", "gamma", "done")]


@pytest.mark.parametrize(("limit", "ids"), [(0, ["a", "b", "c"]), (1, ["a"]), (2, ["a", "b"]), (3, ["a", "b", "c"])])
def test_chain_and_step_limit_include_initial_scan(limit, ids):
    candidates = chain()
    result = pb.activate_lore(candidates, [message("start")], scan_depth=8, budget=4000,
                              recursive_scanning=True, max_recursion_steps=limit)
    assert [item.id for item in result] == ids
    assert [item.recursion_step for item in result] == list(range(len(ids)))
    if len(result) > 1:
        assert result[1].activation_reason == "recursion"
        assert result[1].triggered_by == (("book", "a"),)
    assert all(item.recursion_step == 0 and not item.triggered_by for item in candidates)


def test_disabled_recursion_retains_one_pass_behavior():
    assert [item.id for item in pb.activate_lore(chain(), [message("start")], scan_depth=8, budget=4000)] == ["a"]


def test_cycle_terminates_and_each_entry_is_accepted_once():
    result = pb.activate_lore_books([book("book", [entry("a", "start", "beta"), entry("b", "beta", "start")])], [message("start")])
    assert [item.id for item in result] == ["a", "b"]


def test_excluded_entry_can_match_chat_but_not_recursive_text():
    candidates = [entry("a", "start", "beta"), entry("b", "beta", "gamma", exclude_recursion=True)]
    assert [item.id for item in pb.activate_lore_books([book("book", candidates)], [message("start")])] == ["a"]
    assert [item.id for item in pb.activate_lore_books([book("book", candidates)], [message("beta")])] == ["b"]


def test_prevent_further_recursion_only_blocks_donation():
    result = pb.activate_lore_books([book("book", [entry("a", "start", "beta", prevent_recursion=True), *chain()[1:]])], [message("start")])
    assert [item.id for item in result] == ["a"]


def test_delayed_levels_wait_for_lower_level_closure_not_numeric_pass_number():
    candidates = [
        entry("high", None, "high", constant=True, delay_until_recursion=7, order=0),
        entry("low", None, "low-token", constant=True, delay_until_recursion=2, order=1),
        entry("tail", "low-token", "tail", order=2),
        entry("seed", "start", "seed", order=3),
    ]
    result = pb.activate_lore_books([book("book", candidates)], [message("start")])
    by_id = {item.id: item for item in result}
    assert [item.id for item in result] == ["seed", "low", "tail", "high"]
    assert by_id["low"].recursion_step == 1
    assert by_id["high"].recursion_step > by_id["tail"].recursion_step
    assert by_id["low"].activation_reason == "recursion_delay"
    assert by_id["low"].triggered_by == ()


def test_budget_rejected_entries_never_trigger_other_entries():
    candidates = [entry("oversized", "start", "beta TOO LARGE", order=0),
                  entry("small", "start", "ok", order=1), entry("hidden", "beta", "x", order=2)]
    result = pb.activate_lore_books([book("book", candidates, token_budget=3)], [message("start")])
    assert [item.id for item in result] == ["small"]


def test_cross_book_recursion_preserves_each_budget_and_switch():
    source = book("a", [entry("a1", "start", "beta", worldbook_id="a")], token_budget=4)
    target = book("b", [entry("b1", "beta", "gamma", worldbook_id="b")], token_budget=5)
    result = pb.activate_lore_books([target, source], [message("start")])
    assert [item.id for item in result] == ["a1", "b1"]
    assert result[1].triggered_by == (("a", "a1"),)
    assert [item.id for item in pb.activate_lore_books([replace(target, token_budget=4), source], [message("start")])] == ["a1"]
    assert [item.id for item in pb.activate_lore_books([target, replace(source, recursive_scanning=False)], [message("start")])] == ["a1"]
    assert [item.id for item in pb.activate_lore_books([replace(target, recursive_scanning=False), source], [message("start")])] == ["a1"]


def test_per_entry_scan_depth_is_independent_of_recursive_sources():
    candidates = [entry("a", "older", "beta", depth=2), entry("b", "beta", "done", depth=1)]
    result = pb.activate_lore_books([book("book", candidates, scan_depth=1)], [message("older"), message("recent")])
    assert [item.id for item in result] == ["a", "b"]


def test_trigger_provenance_includes_secondary_keys_and_cross_entry_regex():
    candidates = [entry("a", "start", "alpha"), entry("b", "start", "beta"),
                  entry("regex", "/alpha\\nbeta/", "done"),
                  entry("selective", "alpha", "done", selective=True, secondary_keys=["beta"])]
    result = pb.activate_lore_books([book("book", candidates)], [message("start")])
    assert result[2].triggered_by == (("book", "a"), ("book", "b"))
    assert result[3].triggered_by == (("book", "a"), ("book", "b"))


@pytest.mark.parametrize("key", ["/(?=beta)/", "/(?<=beta)/"])
def test_zero_width_regex_keeps_its_triggering_source(key):
    result = pb.activate_lore_books([book("book", [entry("a", "start", "beta"), entry("b", key, "target")])], [message("start")])
    assert result[1].activation_reason == "recursion"
    assert result[1].triggered_by == (("book", "a"),)


def test_context_uses_only_selected_branch_and_includes_embedded_book():
    engine = create_database_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            character = models.Character(name="Apeiria", character_book={
                "recursive_scanning": True, "scan_depth": 1, "token_budget": 100,
                "entries": [{"keys": ["bridge"], "content": "{{char}} finale", "extensions": {"delay_until_recursion": True}}],
            })
            lore = models.WorldBook(id="book", name="World", recursive_scanning=True, entries=[
                models.WorldBookEntry(id="seed", keys=["left"], content="bridge"),
                models.WorldBookEntry(id="last", keys=["Apeiria finale"], content="completed"),
                models.WorldBookEntry(id="leak", keys=["secret-sibling"], content="must not appear"),
            ])
            session = models.ChatSession(title="Branches", character=character)
            db.add_all([lore, session, models.GlobalWorldbookRegexConfig(id="default", worldbook_ids=["book"])])
            db.commit()
            left = create_message(db, session, parent_id=None, role="user", content="left")
            right = create_swipe(db, left, role="user", speaker="User", content="secret-sibling")
            select_message(db, left)
            result = pb.build_context(db, session)
            by_id = {item.id: item for item in result.activated_lore}
            assert set(by_id) == {"seed", "character_book:0", "last"}
            assert by_id["character_book:0"].recursion_step == 1
            assert by_id["character_book:0"].triggered_by[0].id == "seed"
            assert by_id["last"].triggered_by[0].worldbook_id == f"character:{character.id}"
            select_message(db, right)
            assert [item.id for item in pb.build_context(db, session).activated_lore] == ["leak"]
            # The inactive left branch still has its original content.
            assert db.get(models.Message, left.id).content == "left"
    finally:
        engine.dispose()
