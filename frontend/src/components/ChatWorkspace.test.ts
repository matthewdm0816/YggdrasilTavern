import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { generationTokenDisplay, getMessagePresentation, MessageCacheUsage, messageEditDraft, messageEditHasChanges } from "./ChatWorkspace";

describe("messageEditDraft", () => {
  it("keeps both visible content and thinking content editable", () => {
    expect(messageEditDraft({ id: "message-1", content: "Visible reply", thinking_content: "Reasoning trace" })).toEqual({
      messageId: "message-1",
      value: "Visible reply",
      thinkingValue: "Reasoning trace"
    });
  });
});

describe("messageEditHasChanges", () => {
  const message = { id: "message-1", content: "Visible reply", thinking_content: "Reasoning trace" };

  it("treats an untouched draft as unchanged", () => {
    expect(messageEditHasChanges(messageEditDraft(message), message)).toBe(false);
  });

  it("detects edits to the visible content or the thinking content", () => {
    const draft = messageEditDraft(message);
    expect(messageEditHasChanges({ ...draft, value: "Edited reply" }, message)).toBe(true);
    expect(messageEditHasChanges({ ...draft, thinkingValue: "Edited trace" }, message)).toBe(true);
  });
});

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
      statusLabel: "已完成"
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

describe("message cache usage", () => {
  it("shows cache reads and writes separately from the persisted message usage", () => {
    const html = renderToStaticMarkup(createElement(MessageCacheUsage, { message: {
      cached_tokens: 0, usage: { cache_read_input_tokens: 1200, cache_creation_input_tokens: 600 }
    } }));
    expect(html).toContain("缓存读取 1200");
    expect(html).toContain("缓存写入 600");
  });

  it("retains summarized and legacy cache reads while using full usage for writes", () => {
    expect(renderToStaticMarkup(createElement(MessageCacheUsage, { message: {
      cached_tokens: 300, usage: { cache_creation_input_tokens: 40 }, generation_run: { cached_input_tokens: 500 }
    } }))).toBe("<span>缓存读取 500</span><span>缓存写入 40</span>");
    expect(renderToStaticMarkup(createElement(MessageCacheUsage, { message: {
      cached_tokens: 300, usage: {}
    } }))).toBe("<span>缓存读取 300</span>");
  });

  it("shows a cache write on the first request and omits absent or invalid usage", () => {
    expect(renderToStaticMarkup(createElement(MessageCacheUsage, { message: {
      cached_tokens: 0, usage: { cache_creation_input_tokens: 700 }
    } }))).toBe("<span>缓存写入 700</span>");
    expect(renderToStaticMarkup(createElement(MessageCacheUsage, { message: {
      cached_tokens: 0, usage: { cache_creation_input_tokens: NaN }
    } }))).toBe("");
  });
});
