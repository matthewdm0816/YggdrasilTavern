from app import schemas
from app.models import APIProfile
from app.services.prompt_builder import apply_context_token_limit
from app.services.token_counter import count_text_tokens
from app.services.token_limits import (
    ResolvedTokenLimits,
    apply_provider_output_limit,
    resolve_profile_token_limits,
)


def block(name: str, content: str, *, history: bool = False) -> schemas.CompiledPromptBlock:
    return schemas.CompiledPromptBlock(
        slot_id="history" if history else name,
        slot_kind="history" if history else "custom",
        slot_name=name,
        source=name,
        role="user" if history else "system",
        content=content,
        token_count=0,
        is_history=history,
        message_id=name if history else None,
    )


def context_with(blocks: list[schemas.CompiledPromptBlock]) -> schemas.ContextPreviewOut:
    return schemas.ContextPreviewOut(
        system="",
        messages=[],
        activated_lore=[],
        compiled_blocks=blocks,
    )


def test_context_limit_drops_only_oldest_history_and_keeps_latest_suffix():
    blocks = [block("fixed", "fixed instructions")]
    blocks.extend(block(f"history-{index}", f"history message {index} " * 12, history=True) for index in range(5))
    fixed_cost = count_text_tokens(blocks[0].content) + 4
    latest_cost = sum(count_text_tokens(item.content) + 4 for item in blocks[-2:])
    limits = ResolvedTokenLimits(
        configured_input_tokens=fixed_cost + latest_cost,
        configured_output_tokens=100,
        effective_input_tokens=fixed_cost + latest_cost,
        effective_output_tokens=100,
    )

    limited = apply_context_token_limit(context_with(blocks), model="", limits=limits)
    assert [item.source for item in limited.compiled_blocks] == ["fixed", "history-3", "history-4"]
    assert limited.dropped_history_count == 3
    assert limited.estimated_input_tokens <= limited.effective_input_token_limit
    assert any(item.code == "history_truncated" for item in limited.diagnostics)


def test_context_limit_reports_error_instead_of_dropping_required_latest_history():
    blocks = [
        block("fixed", "fixed " * 50),
        block("latest-user", "latest user " * 50, history=True),
    ]
    limits = ResolvedTokenLimits(
        configured_input_tokens=32,
        configured_output_tokens=16,
        effective_input_tokens=32,
        effective_output_tokens=16,
    )
    limited = apply_context_token_limit(context_with(blocks), model="", limits=limits)
    assert len(limited.compiled_blocks) == 2
    assert any(item.code == "context_limit_exceeded" and item.level == "error" for item in limited.diagnostics)


def test_profile_limits_reserve_output_inside_a_reported_total_context_window():
    profile = APIProfile(
        name="Kimi",
        provider_type="openai_chat_completions",
        base_url="https://example.test",
        model="kimi",
        api_key="secret",
        api_key_env="",
        default_params={},
        input_token_limit=262144,
        output_token_limit=32768,
        model_catalog=[{"id": "kimi", "max_total_tokens": 262144}],
    )
    limits = resolve_profile_token_limits(profile)
    assert limits.configured_input_tokens == 262144
    assert limits.effective_input_tokens == 229376
    assert limits.effective_output_tokens == 32768


def test_output_limit_maps_to_each_provider_without_leaking_conflicting_fields():
    limits = ResolvedTokenLimits(
        configured_input_tokens=1000,
        configured_output_tokens=32000,
        effective_input_tokens=1000,
        effective_output_tokens=16000,
    )
    assert apply_provider_output_limit("openai_responses", {"max_tokens": 4}, limits)["max_output_tokens"] == 16000
    assert apply_provider_output_limit("openai_chat_completions", {}, limits)["max_completion_tokens"] == 16000
    assert apply_provider_output_limit("openai_chat_completions", {"max_tokens": 4}, limits)["max_tokens"] == 16000
    assert apply_provider_output_limit("anthropic_messages", {"max_output_tokens": 4}, limits)["max_tokens"] == 16000
