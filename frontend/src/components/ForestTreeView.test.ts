import { describe, expect, it } from "vitest";
import { Message } from "../lib/api";
import { buildForest } from "./ForestTreeView";

function message(id: string, parentId: string | null, order: number): Message {
  return {
    id,
    session_id: "session",
    parent_id: parentId,
    selected_child_id: null,
    role: "assistant",
    speaker: "A",
    content: id,
    thinking_content: "",
    status: "complete",
    token_count: 1,
    thinking_token_count: 0,
    cached_tokens: 0,
    sort_order: order,
    provider_metadata: {},
    usage: {},
    created_at: `2026-01-01T00:00:0${order}`,
    updated_at: `2026-01-01T00:00:0${order}`
  };
}

describe("buildForest", () => {
  it("keeps every root and sorts each sibling group", () => {
    const forest = buildForest([
      message("child-2", "root-1", 2),
      message("root-2", null, 2),
      message("child-1", "root-1", 1),
      message("root-1", null, 1)
    ]);
    expect(forest.roots.map((node) => node.message.id)).toEqual(["root-1", "root-2"]);
    expect(forest.roots[0].children.map((node) => node.message.id)).toEqual(["child-1", "child-2"]);
    expect(forest.warnings).toEqual([]);
  });

  it("shows a node with a missing parent as another root", () => {
    const forest = buildForest([message("orphan", "missing", 1)]);
    expect(forest.roots.map((node) => node.message.id)).toEqual(["orphan"]);
    expect(forest.warnings.join(" ")).toContain("不存在的父节点");
  });

  it("breaks malformed cycles instead of recursing forever", () => {
    const forest = buildForest([message("a", "b", 1), message("b", "a", 2)]);
    expect(forest.roots.length).toBe(1);
    expect(forest.warnings.length).toBeGreaterThan(0);
  });
});
