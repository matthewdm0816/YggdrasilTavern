import { describe, expect, it } from "vitest";
import { activeMessages, siblingsFor } from "./tree";
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
});
