import json

import pytest

from app import models, schemas
from app.services.provider_protocols.anthropic import extract_anthropic_usage, prepare_request
from app.services.token_counter import cached_tokens_from_usage, input_tokens_from_usage, merge_usage


def context():
    blocks = [
        schemas.CompiledPromptBlock(slot_id="main", slot_kind="main", slot_name="Main", source="test",
                                    role="system", content="Stable system", token_count=2),
        schemas.CompiledPromptBlock(slot_id="history", slot_kind="history", slot_name="History", source="test",
                                    role="user", content="User history", token_count=2, is_history=True),
        schemas.CompiledPromptBlock(slot_id="history", slot_kind="history", slot_name="History", source="test",
                                    role="assistant", content="Assistant history", token_count=2, is_history=True),
        schemas.CompiledPromptBlock(slot_id="post", slot_kind="post_history", slot_name="Post", source="test",
                                    role="system", content="Trailing instruction", token_count=2),
    ]
    return schemas.ContextPreviewOut(system="Stable system", messages=[], activated_lore=[], compiled_blocks=blocks)


def profile(enabled):
    item = models.APIProfile(name="Synthetic", provider_type="anthropic_messages", model="claude-test", base_url="https://provider.test")
    item.anthropic_prompt_cache = enabled
    return item


def test_prompt_caching_is_opt_in_and_marks_system_tail_and_last_history():
    disabled = prepare_request(profile(False), context(), {"max_tokens": 128}, "key").payload
    enabled = prepare_request(profile(True), context(), {"max_tokens": 128}, "key").payload
    assert "cache_control" not in json.dumps(disabled)
    assert enabled["system"][-1]["cache_control"] == {"type": "ephemeral"}
    assert enabled["messages"][-2]["content"][-1]["text"] == "Assistant history"
    assert enabled["messages"][-2]["content"][-1]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in enabled["messages"][-1]["content"][-1]
    assert json.dumps(enabled).count('"cache_control"') == 2


def test_cache_mode_preserves_message_text_when_same_role_blocks_are_joined():
    prompt = context()
    prompt.compiled_blocks[2] = prompt.compiled_blocks[2].model_copy(update={"role": "user"})
    disabled = prepare_request(profile(False), prompt, {}, "key").payload
    enabled = prepare_request(profile(True), prompt, {}, "key").payload
    for before, after in zip(disabled["messages"], enabled["messages"], strict=True):
        assert before["role"] == after["role"]
        assert before["content"] == "".join(block["text"] for block in after["content"])
    assert enabled["messages"][0]["content"][-2]["cache_control"] == {"type": "ephemeral"}
    assert "cache_control" not in enabled["messages"][0]["content"][-1]


def test_cache_mode_respects_existing_breakpoint_capacity_without_mutating_params():
    params = {"tools": [{"name": f"tool-{i}", "input_schema": {"type": "object"}, "cache_control": {"type": "ephemeral"}} for i in range(3)]}
    before = json.dumps(params, sort_keys=True)
    result = prepare_request(profile(True), context(), params, "key").payload
    assert json.dumps(result).count('"cache_control"') <= 4
    assert json.dumps(params, sort_keys=True) == before


def test_anthropic_usage_preserves_cache_read_write_and_total_input_across_deltas():
    start = extract_anthropic_usage({"type": "message_start", "message": {"usage": {
        "input_tokens": 25, "cache_creation_input_tokens": 2000, "cache_read_input_tokens": 5000, "output_tokens": 1,
    }}})
    final = extract_anthropic_usage({"type": "message_delta", "usage": {"output_tokens": 17}})
    usage = merge_usage(start, final)
    assert input_tokens_from_usage(usage) == 7025
    assert cached_tokens_from_usage(usage) == 5000
    assert usage["cache_creation_input_tokens"] == 2000
    assert usage["output_tokens"] == 17


def test_partial_cache_usage_updates_do_not_erase_the_total_input():
    start = extract_anthropic_usage({"type": "message_start", "message": {"usage": {
        "input_tokens": 25, "cache_creation_input_tokens": 2000, "cache_read_input_tokens": 5000,
    }}})
    later = extract_anthropic_usage({"type": "message_delta", "usage": {"cache_read_input_tokens": 5000, "output_tokens": 20}})
    assert input_tokens_from_usage(merge_usage(start, later)) == 7025
