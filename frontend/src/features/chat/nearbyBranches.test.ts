import { describe, expect, it } from "vitest";
import type { Message, SessionTree } from "../../lib/api";
import { nearbyBranchGroups } from "./nearbyBranches";

function message(id: string, parentId: string | null, order = 0): Message {
  return {
    id, session_id: "one", parent_id: parentId, selected_child_id: null,
    role: "assistant", speaker: "A", content: id, thinking_content: "",
    status: "complete", token_count: 0, thinking_token_count: 0, cached_tokens: 0,
    sort_order: order, provider_metadata: {}, usage: {},
    created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00"
  };
}

function tree(messages: Message[], path: string[]): SessionTree {
  return { session: { id: "one", title: "One", preset: {} }, messages, active_path_ids: path };
}

describe("nearby branch groups", () => {
  it("keeps root alternate greetings and active-path siblings without inactive descendants", () => {
    const original = tree([
      message("root-active", null, 1), message("root-alternate", null, 0),
      message("child-active", "root-active", 1), message("child-alternate", "root-active", 0),
      message("inactive-deep", "child-alternate"), message("inactive-root-deep", "root-alternate"),
      message("tip", "child-active")
    ], ["root-active", "child-active", "tip"]);
    const snapshot = JSON.stringify(original);
    const groups = nearbyBranchGroups(original);
    expect(groups.map((group) => group.parentId)).toEqual(["root-active", null]);
    expect(groups.map((group) => group.messagePosition)).toEqual([2, 1]);
    expect(groups.map((group) => group.activeMessageId)).toEqual(["child-active", "root-active"]);
    expect(groups.flatMap((group) => group.branches.map((item) => item.id))).toEqual([
      "child-alternate", "child-active", "root-alternate", "root-active"
    ]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it("includes direct continuations from a selected tip while keeping other subtrees out", () => {
    const groups = nearbyBranchGroups(tree([
      message("root", null), message("next-two", "root", 2), message("next-one", "root", 1),
      message("deeper", "next-one")
    ], ["root"]));
    expect(groups).toHaveLength(1);
    expect(groups[0].parentId).toBe("root");
    expect(groups[0].activeMessageId).toBeNull();
    expect(groups[0].messagePosition).toBe(2);
    expect(groups[0].branches.map((item) => item.id)).toEqual(["next-one", "next-two"]);
  });

  it("shows roots when no active path is selected and handles a missing tree", () => {
    expect(nearbyBranchGroups()).toEqual([]);
    expect(nearbyBranchGroups(tree([], []))).toEqual([]);
    const groups = nearbyBranchGroups(tree([message("root", null), message("child", "root")], []));
    expect(groups[0].branches.map((item) => item.id)).toEqual(["root"]);
    expect(groups[0].activeMessageId).toBeNull();
  });

  it("orders forks nearest the selected tip first", () => {
    const groups = nearbyBranchGroups(tree([
      message("r", null), message("r-alt", null),
      message("a", "r"), message("a-alt", "r"),
      message("b", "a"), message("b-alt", "a")
    ], ["r", "a", "b"]));
    expect(groups.map((group) => group.parentId)).toEqual(["a", "r", null]);
  });
});
