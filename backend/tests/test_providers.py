from app.services.providers import (
    extract_anthropic_delta,
    extract_anthropic_thinking_delta,
    extract_openai_chat_delta,
    extract_openai_chat_thinking_delta,
    extract_openai_responses_delta,
    extract_openai_responses_thinking_delta,
    extract_usage,
)


def test_provider_delta_extractors():
    assert extract_anthropic_delta({"type": "content_block_delta", "delta": {"type": "text_delta", "text": "hi"}}) == "hi"
    assert extract_openai_chat_delta({"choices": [{"delta": {"content": "hello"}}]}) == "hello"
    assert extract_openai_responses_delta({"type": "response.output_text.delta", "delta": "hey"}) == "hey"


def test_provider_thinking_and_usage_extractors():
    assert (
        extract_anthropic_thinking_delta({"type": "content_block_delta", "delta": {"type": "thinking_delta", "thinking": "hmm"}})
        == "hmm"
    )
    assert extract_openai_chat_thinking_delta({"choices": [{"delta": {"reasoning_content": "think"}}]}) == "think"
    assert extract_openai_responses_thinking_delta({"type": "response.reasoning_summary_text.delta", "delta": "summary"}) == "summary"
    assert extract_usage({"response": {"usage": {"input_tokens_details": {"cached_tokens": 12}}}}) == {
        "input_tokens_details": {"cached_tokens": 12}
    }
