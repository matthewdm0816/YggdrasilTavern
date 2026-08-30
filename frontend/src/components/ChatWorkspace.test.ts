import { describe, expect, it } from "vitest";
import { generationTokenDisplay, getMessagePresentation } from "./ChatWorkspace";

describe("getMessagePresentation", () => {
  it("marks only a streaming message as busy and highlighted", () => {
    expect(getMessagePresentation({ role: "assistant", status: "streaming" })).toEqual({
      isStreaming: true,
      rowClassName: "message-row assistant is-streaming",
      statusLabel: "正在生成"
    });
  });

  it("does not highlight a completed swipe", () => {
    expect(getMessagePresentation({ role: "assistant", status: "complete" })).toEqual({
      isStreaming: false,
      rowClassName: "message-row assistant",
      statusLabel: "complete"
    });
  });
});

describe("generationTokenDisplay", () => {
  const base = {
    status: "complete",
    token_count: 90,
    thinking_token_count: 30,
    provider_metadata: {},
    usage: {}
  };

  it("keeps a plausible final provider count authoritative", () => {
    expect(generationTokenDisplay({
      ...base,
      generation_run: { output_tokens: 80, duration_seconds: 10, tokens_per_second: 8 }
    })).toEqual({ outputTokens: 80, outputEstimated: false, tokensPerSecond: 8 });
  });

  it("falls back for an implausibly tiny historical provider count", () => {
    expect(generationTokenDisplay({
      ...base,
      token_count: 300,
      thinking_token_count: 60,
      generation_run: { output_tokens: 20, duration_seconds: 12, tokens_per_second: 1.7 }
    })).toEqual({ outputTokens: 360, outputEstimated: true, tokensPerSecond: 30 });
  });

  it("uses preserved partial content for a cancelled generation", () => {
    expect(generationTokenDisplay({
      ...base,
      status: "cancelled",
      generation_run: { output_tokens: 1, duration_seconds: 4, tokens_per_second: 0.25 }
    })).toEqual({ outputTokens: 120, outputEstimated: true, tokensPerSecond: 30 });
  });
});
