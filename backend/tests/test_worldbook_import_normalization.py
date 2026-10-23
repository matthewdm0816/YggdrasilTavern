import json

import pytest

from app import models
from app.api.worldbooks import _export_worldbook_entry
from app.services.st_import import load_worldbook_upload, normalize_worldbook
from app.services.worldbook_import import normalize_worldbook_entry, normalize_worldbook_settings, worldbook_import_warnings


@pytest.mark.parametrize("fields, expected", [
    ({"depth": 4, "scanDepth": 1}, 1),
    ({"extensions": {"depth": 4, "scan_depth": 2}}, 2),
    ({"depth": 4, "scanDepth": None}, None),
    ({"depth": 4}, None),
])
def test_direct_upload_scan_depth_never_uses_st_insertion_depth(fields, expected):
    raw = {"entries": [{"keys": ["moon"], "content": "Synthetic lore", **fields}]}
    book = load_worldbook_upload(json.dumps(raw).encode(), "synthetic.json")
    assert book.entries[0].depth == expected


@pytest.mark.parametrize("delay,expected", [(False, 0), (True, 1), (0, 0), (2, 2), (7, 7)])
@pytest.mark.parametrize("extended", [False, True])
def test_recursion_options_preserve_numeric_delay_levels(delay, expected, extended):
    fields = ({"exclude_recursion": True, "prevent_recursion": True, "delay_until_recursion": delay}
              if extended else {"excludeRecursion": True, "preventRecursion": True, "delayUntilRecursion": delay})
    raw = {"keys": ["moon"], "extensions": fields} if extended else {"keys": ["moon"], **fields}
    book = normalize_worldbook({"recursive_scanning": True, "max_recursion_steps": 4, "entries": [raw]})
    entry = book.entries[0]
    assert (entry.exclude_recursion, entry.prevent_recursion, entry.delay_until_recursion) == (True, True, expected)
    assert book.recursive_scanning and book.max_recursion_steps == 4


def test_zero_values_and_explicit_false_override_inherited_settings():
    assert normalize_worldbook_settings({"scan_depth": 0, "token_budget": 0, "recursive_scanning": False, "max_recursion_steps": 0}, defaults={"scan_depth": 8, "token_budget": 10, "recursive_scanning": True, "max_recursion_steps": 9}) == {
        "scan_depth": 0, "token_budget": 0, "recursive_scanning": False, "max_recursion_steps": 0,
    }


@pytest.mark.parametrize("field,value", [("delayUntilRecursion", -1), ("delayUntilRecursion", 1.5), ("scanDepth", -1)])
def test_invalid_nonnegative_import_values_are_reported(field, value):
    with pytest.raises(ValueError, match="非负整数"):
        normalize_worldbook_entry({field: value})


def test_character_extension_position_is_honored_and_warned():
    raw = {"entries": [{"position": "after_char", "extensions": {"position": 4, "depth": 9, "scan_depth": 1}}]}
    book = normalize_worldbook(raw)
    assert not book.entries[0].enabled
    assert book.entries[0].position == "4"
    assert book.entries[0].depth == 1
    assert "@D" in worldbook_import_warnings(raw)[0]
    assert models.Character(character_book=raw).import_warnings == worldbook_import_warnings(raw)
    assert models.WorldBook(raw_json=raw).import_warnings == worldbook_import_warnings(raw)


def test_edited_entry_export_updates_aliases_and_keeps_insertion_depth_separate():
    source = {"depth": 9, "scanDepth": 1, "excludeRecursion": True, "delayUntilRecursion": True,
              "extensions": {"position": 4, "depth": 9, "scan_depth": 1, "exclude_recursion": True, "delay_until_recursion": 1}}
    entry = models.WorldBookEntry(
        uid="synthetic", keys=["moon"], secondary_keys=[], content="lore", enabled=True,
        constant=False, selective=False, order=1, position="after_char", depth=3,
        case_sensitive=True, match_whole_words=False, exclude_recursion=False,
        prevent_recursion=True, delay_until_recursion=5, raw_json=source,
    )
    exported = _export_worldbook_entry(entry)
    assert exported["depth"] == 9
    assert exported["scanDepth"] == exported["extensions"]["scan_depth"] == 3
    assert exported["excludeRecursion"] is False
    assert exported["extensions"]["exclude_recursion"] is False
    imported = normalize_worldbook({"entries": [exported]}).entries[0]
    assert imported.depth == 3 and imported.enabled and imported.position == "after_char"
    assert not imported.exclude_recursion and imported.prevent_recursion and imported.delay_until_recursion == 5
    assert worldbook_import_warnings({"entries": [exported]}) == []


def test_new_entry_export_does_not_emit_internal_scan_depth_as_st_depth():
    entry = models.WorldBookEntry(uid=None, keys=[], secondary_keys=[], content="lore", enabled=True,
        constant=False, selective=False, order=1, position="before_char", depth=6,
        case_sensitive=False, match_whole_words=False, exclude_recursion=False,
        prevent_recursion=False, delay_until_recursion=0, raw_json={})
    exported = _export_worldbook_entry(entry)
    assert exported["scanDepth"] == 6 and "depth" not in exported
