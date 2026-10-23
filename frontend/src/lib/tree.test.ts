import { describe, expect, it } from "vitest";
import { activeMessages, buildMessageIndex, mergeStreamingMessages, siblingsFor } from "./tree";
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
  it.each([false, true])("keeps path order, repeated IDs, first matches and missing-ID filtering (indexed: %s)", (indexed) => {
    const first = message("root", null, 1, "first duplicate");
    const duplicate = message("root", null, 2, "later duplicate");
    const child = message("child", "root", 1, "child");
    const tree: SessionTree = {
      session: { id: "s1", title: "t", preset: {} },
      messages: [child, first, duplicate],
      active_path_ids: ["child", "missing", "root", "child"]
    };
    const index = indexed ? buildMessageIndex(tree.messages) : undefined;
    const result = activeMessages(tree, index);
    expect(result).toEqual([child, first, child]);
    expect(result[1]).toBe(first);
    expect(tree.messages).toEqual([child, first, duplicate]);
  });

  it.each([false, true])("keeps root siblings ordered by order, creation time and stable ties (indexed: %s)", (indexed) => {
    const earliest = message("earliest", null, 0, "earliest");
    const firstTie = message("first-tie", null, 1, "first tie");
    const secondTie = message("second-tie", null, 1, "second tie");
    const later = { ...message("later", null, 1, "later"), created_at: "2026-01-02T00:00:00" };
    const child = message("child", "earliest", 0, "child");
    const messages = [later, secondTie, child, earliest, firstTie];
    const tree: SessionTree = { session: { id: "s1", title: "t", preset: {} }, messages, active_path_ids: [] };
    const index = indexed ? buildMessageIndex(messages) : undefined;
    expect(siblingsFor(tree, later, index)).toEqual([earliest, secondTie, firstTie, later]);
    expect(siblingsFor(tree, child, index)).toEqual([child]);
    expect(messages).toEqual([later, secondTie, child, earliest, firstTie]);
  });

  it.each([false, true])("keeps null and missing parent IDs in separate sibling groups (indexed: %s)", (indexed) => {
    const root = message("root", null, 0, "root");
    const missingParent = { ...message("legacy", null, 0, "legacy"), parent_id: undefined };
    const messages = [root, missingParent];
    const tree: SessionTree = { session: { id: "s1", title: "t", preset: {} }, messages, active_path_ids: [] };
    const index = indexed ? buildMessageIndex(messages) : undefined;
    expect(siblingsFor(tree, root, index)).toEqual([root]);
    expect(siblingsFor(tree, missingParent, index)).toEqual([missingParent]);
    expect(siblingsFor(tree, message("absent", "missing", 0, "absent"), index)).toEqual([]);
  });

  it("preserves empty-tree and missing-tree behavior with an index", () => {
    const current = message("current", null, 0, "current");
    const index = buildMessageIndex([]);
    const empty: SessionTree = { session: { id: "s1", title: "t", preset: {} }, messages: [], active_path_ids: ["missing"] };
    expect(activeMessages(undefined, index)).toEqual([]);
    expect(activeMessages(empty, index)).toEqual([]);
    expect(siblingsFor(undefined, current, index)).toEqual([current]);
    expect(siblingsFor(empty, current, index)).toEqual([]);
  });

  it("uses the new streamed message after the message array changes", () => {
    const original = message("reply", null, 0, "partial");
    const before: SessionTree = { session: { id: "s1", title: "t", preset: {} }, messages: [original], active_path_ids: ["reply"] };
    const beforeIndex = buildMessageIndex(before.messages);
    const updated = { ...original, content: "partial plus token" };
    const after = { ...before, messages: [updated] };
    const afterIndex = buildMessageIndex(after.messages);
    expect(activeMessages(after, afterIndex)).toEqual([updated]);
    expect(siblingsFor(after, updated, afterIndex)[0]).toBe(updated);
    expect(activeMessages(before, beforeIndex)[0]).toBe(original);
  });

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
