import { describe, expect, it } from "vitest";
import { getMessagePresentation } from "./ChatWorkspace";

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
