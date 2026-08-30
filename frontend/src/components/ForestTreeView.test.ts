import { describe, expect, it } from "vitest";
import { Message } from "../lib/api";
import {
  activePathExpandedNodeIds,
  allExpandableNodeIds,
  buildForest,
  shouldJumpToNode,
  visibleForestRows
} from "./ForestTreeView";

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
    expect(forest.roots[0].descendantCount).toBe(2);
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

describe("Forest visibility", () => {
  const messages = [
    message("root", null, 1),
    message("active-parent", "root", 1),
    message("active-leaf", "active-parent", 1),
    message("side-branch", "root", 2),
    message("side-child", "side-branch", 1),
    message("side-grandchild", "side-child", 1)
  ];

  it("opens the active path by default and reports all hidden descendants of side branches", () => {
    const forest = buildForest(messages);
    const expanded = activePathExpandedNodeIds(forest, ["root", "active-parent", "active-leaf"]);
    expect([...expanded]).toEqual(["root", "active-parent"]);

    const rows = visibleForestRows(forest, expanded);
    expect(rows.map((row) => row.node.message.id)).toEqual([
      "root",
      "active-parent",
      "active-leaf",
      "side-branch"
    ]);
    expect(rows.find((row) => row.node.message.id === "side-branch")?.hiddenDescendantCount).toBe(2);
  });

  it("supports expand all, collapse all, and dozens of vertical depth levels", () => {
    const chain = Array.from({ length: 60 }, (_, index) => message(`node-${index}`, index ? `node-${index - 1}` : null, 1));
    const forest = buildForest(chain);
    const expandedRows = visibleForestRows(forest, allExpandableNodeIds(forest));
    expect(expandedRows).toHaveLength(60);
    expect(expandedRows[expandedRows.length - 1]?.depth).toBe(59);

    const collapsedRows = visibleForestRows(forest, new Set());
    expect(collapsedRows).toHaveLength(1);
    expect(collapsedRows[0].hiddenDescendantCount).toBe(59);
  });

  it("searches inside collapsed subtrees and shows only matches plus their ancestor paths", () => {
    const forest = buildForest(messages.map((item) => item.id === "side-grandchild" ? { ...item, content: "Needle in another branch" } : item));
    const rows = visibleForestRows(forest, new Set(), "needle");
    expect(rows.map((row) => row.node.message.id)).toEqual(["root", "side-branch", "side-child", "side-grandchild"]);
    expect(rows.filter((row) => row.isSearchMatch).map((row) => row.node.message.id)).toEqual(["side-grandchild"]);
  });

  it("preserves the pin-first, second-click-to-jump interaction", () => {
    expect(shouldJumpToNode(null, "node")).toBe(false);
    expect(shouldJumpToNode("other", "node")).toBe(false);
    expect(shouldJumpToNode("node", "node")).toBe(true);
  });
});
