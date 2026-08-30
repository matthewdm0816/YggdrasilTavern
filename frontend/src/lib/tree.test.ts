import { describe, expect, it } from "vitest";
import { activeMessages, mergeStreamingMessages, siblingsFor } from "./tree";
import { Message, SessionTree } from "./api";

function message(id: string, parent_id: string | null, sort_order: number, content: string): Message {
  return {
    id,
    session_id: "s1",
    parent_id,
    selected_child_id: null,
    role: "assistant",
    speaker: "A",
    content,
    thinking_content: "",
    status: "complete",
    token_count: 1,
    thinking_token_count: 0,
    cached_tokens: 0,
    sort_order,
    provider_metadata: {},
    usage: {},
    created_at: `2026-01-01T00:00:0${sort_order}`,
    updated_at: `2026-01-01T00:00:0${sort_order}`
  };
}

describe("tree helpers", () => {
  it("returns the active path in selected order", () => {
    const tree: SessionTree = {
      session: { id: "s1", title: "t", preset: {} },
      messages: [message("a", null, 1, "root"), message("b", "a", 1, "child")],
      active_path_ids: ["a", "b"]
    };
    expect(activeMessages(tree).map((item) => item.content)).toEqual(["root", "child"]);
  });

  it("sorts sibling swipes by sort order", () => {
    const current = message("b", "a", 2, "second");
    const tree: SessionTree = {
      session: { id: "s1", title: "t", preset: {} },
      messages: [current, message("c", "a", 1, "first"), message("d", null, 1, "other")],
      active_path_ids: ["d", "b"]
    };
    expect(siblingsFor(tree, current).map((item) => item.content)).toEqual(["first", "second"]);
  });

  it("keeps the fuller client stream when a swipe selection returns an older database batch", () => {
    const localStreaming = {
      ...message("stream", "root", 2, "answer so far"),
      status: "streaming",
      thinking_content: "thinking so far",
      token_count: 3,
      thinking_token_count: 4,
      usage: { output_tokens: 7 }
    };
    const current: SessionTree = {
      session: { id: "s1", title: "t", preset: {} },
      messages: [message("root", null, 1, "root"), localStreaming],
      active_path_ids: ["root", "stream"]
    };
    const incoming: SessionTree = {
      ...current,
      messages: [
        message("root", null, 1, "root"),
        { ...localStreaming, content: "answer", thinking_content: "thinking", token_count: 1, thinking_token_count: 1, usage: {} }
      ],
      active_path_ids: ["root"]
    };

    const merged = mergeStreamingMessages(current, incoming);
    const streamed = merged.messages.find((item) => item.id === "stream")!;
    expect(streamed.content).toBe("answer so far");
    expect(streamed.thinking_content).toBe("thinking so far");
    expect(streamed.token_count).toBe(3);
    expect(streamed.thinking_token_count).toBe(4);
    expect(streamed.usage).toEqual({ output_tokens: 7 });
    expect(merged.active_path_ids).toEqual(["root"]);
  });

  it("trusts a terminal server message instead of retaining a streaming draft", () => {
    const local = { ...message("stream", null, 1, "local partial"), status: "streaming" };
    const remote = { ...local, status: "complete", content: "server final" };
    const current: SessionTree = { session: { id: "s1", title: "t", preset: {} }, messages: [local], active_path_ids: ["stream"] };
    const incoming: SessionTree = { ...current, messages: [remote] };
    expect(mergeStreamingMessages(current, incoming).messages[0].content).toBe("server final");
  });
});
