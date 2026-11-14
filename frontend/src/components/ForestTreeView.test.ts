import { describe, expect, it } from "vitest";
import { Message } from "../lib/api";
import {
  activePathExpandedNodeIds,
  allExpandableNodeIds,
  buildDisplayForest,
  buildForest,
  layoutCanvasForest,
  layoutMetroForest,
  moveMetroFocusIndex,
  shouldJumpToNode,
  visibleForestRows
} from "./ForestTreeView";
import { CANVAS_H_GAP } from "../features/tree/canvasLayout";

function message(id: string, parentId: string | null, order: number, overrides: Partial<Message> = {}): Message {
  return {
    id,
    session_id: "session",
    parent_id: parentId,
    selected_child_id: null,
    role: order % 2 === 0 ? "user" : "assistant",
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
    created_at: `2026-01-01T00:00:0${order % 10}`,
    updated_at: `2026-01-01T00:00:0${order % 10}`,
    ...overrides
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

  it("searches expanded macro text while keeping raw content and thinking searchable", () => {
    const node = { ...message("macro", null, 0), content: "Hello {{user}}", thinking_content: "{{scenario}}" };
    const model = buildForest([node]);
    const context = { user_name: "Owner", character: { name: "A", description: "", personality: "", scenario: "Sea", first_mes: "", alternate_greetings: [] } };
    for (const query of ["Owner", "Sea", "{{user}}", "{{scenario}}"]) {
      expect(visibleForestRows(model, new Set(), query, context).map((row) => row.node.message.id)).toEqual(["macro"]);
    }
    expect(node.content).toBe("Hello {{user}}");
  });
});

describe("Chain compression (buildDisplayForest)", () => {
  it("merges >= 2 contiguous single-child interior nodes into a capsule while preserving root and leaf", () => {
    const chain = Array.from({ length: 10 }, (_, idx) =>
      message(`m-${idx}`, idx === 0 ? null : `m-${idx - 1}`, 1)
    );
    const model = buildForest(chain);
    const activeIds = chain.map((m) => m.id);
    const display = buildDisplayForest(model, {
      expandedIds: allExpandableNodeIds(model),
      compressChains: true,
      activePathIds: activeIds,
      activeLeafId: "m-9"
    });

    expect(display.compressedChainCount).toBe(1);
    expect(display.compressedMessageCount).toBe(8);
    expect(display.roots).toHaveLength(1);

    const rootItem = display.roots[0];
    expect(rootItem.kind).toBe("message");
    if (rootItem.kind !== "message") throw new Error("expected message root");
    expect(rootItem.id).toBe("m-0");
    expect(rootItem.children).toHaveLength(1);

    const capsule = rootItem.children[0];
    expect(capsule.kind).toBe("chain");
    if (capsule.kind !== "chain") throw new Error("expected chain capsule");
    expect(capsule.count).toBe(8);
    expect(capsule.nodeIds).toEqual(["m-1", "m-2", "m-3", "m-4", "m-5", "m-6", "m-7", "m-8"]);
    expect(capsule.isOnActivePath).toBe(true);
    expect(capsule.child.kind).toBe("message");
    expect(capsule.child.id).toBe("m-9");
  });

  it("does not compress a single interior node (count < 2) or branch points", () => {
    const msgs = [
      message("root", null, 1),
      message("only-mid", "root", 1),
      message("fork", "only-mid", 1),
      message("leaf-a", "fork", 1),
      message("leaf-b", "fork", 2)
    ];
    const model = buildForest(msgs);
    const display = buildDisplayForest(model, {
      expandedIds: allExpandableNodeIds(model),
      compressChains: true,
      activePathIds: ["root", "only-mid", "fork", "leaf-a"],
      activeLeafId: "leaf-a"
    });
    expect(display.compressedChainCount).toBe(0);
    expect(display.compressedMessageCount).toBe(0);
  });

  it("supports expanding an individual chain segment with re-collapse metadata and keeps pinnedId visible", () => {
    const chain = Array.from({ length: 7 }, (_, idx) =>
      message(`n-${idx}`, idx === 0 ? null : `n-${idx - 1}`, 1)
    );
    const model = buildForest(chain);
    const expandedIds = allExpandableNodeIds(model);

    // Pinned node n-3 splits [n-1..n-5] into [n-1, n-2] (capsule) -> n-3 (visible) -> [n-4, n-5] (capsule).
    const withPinned = buildDisplayForest(model, {
      expandedIds,
      compressChains: true,
      activePathIds: chain.map((m) => m.id),
      activeLeafId: "n-6",
      pinnedId: "n-3"
    });
    expect(withPinned.compressedChainCount).toBe(2);
    expect(withPinned.compressedMessageCount).toBe(4);

    // Manually expanding the chain exposes every node and attaches recollapseChain on n-1.
    const manuallyOpened = buildDisplayForest(model, {
      expandedIds,
      compressChains: true,
      expandedChainNodeIds: new Set(["n-1", "n-2", "n-3", "n-4", "n-5"]),
      activePathIds: chain.map((m) => m.id),
      activeLeafId: "n-6"
    });
    expect(manuallyOpened.compressedChainCount).toBe(0);
    const root = manuallyOpened.roots[0];
    if (root.kind !== "message") throw new Error("expected root message");
    const firstMid = root.children[0];
    expect(firstMid.kind).toBe("message");
    if (firstMid.kind !== "message") throw new Error("expected expanded mid message");
    expect(firstMid.id).toBe("n-1");
    expect(firstMid.recollapseChain).toEqual({
      nodeIds: ["n-1", "n-2", "n-3", "n-4", "n-5"],
      count: 5
    });
  });

  it("automatically opens collapsed subtrees and breaks capsules when search hits an interior node", () => {
    const msgs = [
      message("root", null, 1),
      message("s-1", "root", 1),
      message("s-2", "s-1", 1),
      message("s-3", "s-2", 1, { content: "Secret treasure clue" }),
      message("s-4", "s-3", 1),
      message("s-5", "s-4", 1, { thinking_content: "Another secret clue in thought" })
    ];
    const model = buildForest(msgs);
    // Pass empty expandedIds to verify search still expands collapsed subtrees automatically.
    const display = buildDisplayForest(model, {
      expandedIds: new Set(),
      compressChains: true,
      activePathIds: ["root"],
      activeLeafId: "root",
      searchQuery: "secret"
    });

    expect(display.searchMatchCount).toBe(2);
    const layout = layoutCanvasForest(display.roots);
    const renderedIds = layout.nodes.map((n) => n.id);
    expect(renderedIds).toContain("s-3");
    expect(renderedIds).toContain("s-5");
    expect(renderedIds).toContain("chain:s-1");
  });
});

describe("Canvas vertical topology layout (layoutCanvasForest)", () => {
  it("keeps a 120-layer single-line conversation strictly on the exact same X column (zero horizontal drift)", () => {
    const deepChain = Array.from({ length: 120 }, (_, idx) =>
      message(`turn-${idx}`, idx === 0 ? null : `turn-${idx - 1}`, 1)
    );
    const model = buildForest(deepChain);

    // Uncompressed: all 120 nodes must share identical X and centerX, with strictly increasing Y.
    const uncompressed = buildDisplayForest(model, {
      expandedIds: allExpandableNodeIds(model),
      compressChains: false,
      activePathIds: deepChain.map((m) => m.id),
      activeLeafId: "turn-119"
    });
    const fullLayout = layoutCanvasForest(uncompressed.roots);
    expect(fullLayout.nodes).toHaveLength(120);

    const expectedX = fullLayout.nodes[0].x;
    const expectedCenterX = fullLayout.nodes[0].centerX;
    for (let index = 0; index < fullLayout.nodes.length; index += 1) {
      const placed = fullLayout.nodes[index];
      expect(placed.x).toBe(expectedX);
      expect(placed.centerX).toBe(expectedCenterX);
      if (index > 0) {
        expect(placed.y).toBeGreaterThan(fullLayout.nodes[index - 1].y);
      }
    }

    // Compressed: root -> chain capsule (118 nodes) -> leaf, also aligned on the exact same X column.
    const compressed = buildDisplayForest(model, {
      expandedIds: allExpandableNodeIds(model),
      compressChains: true,
      activePathIds: deepChain.map((m) => m.id),
      activeLeafId: "turn-119"
    });
    const compactLayout = layoutCanvasForest(compressed.roots);
    expect(compactLayout.nodes).toHaveLength(3);
    expect(new Set(compactLayout.nodes.map((n) => n.centerX)).size).toBe(1);
  });

  it("places asymmetric multi-branch subtrees and mixed capsule heights with zero bounding-box overlap", () => {
    const msgs: Message[] = [
      message("root", null, 1),
      // Branch A: short dead-end swipe
      message("a-1", "root", 1),
      // Branch B: long compressed chain that forks widely at the bottom
      message("b-1", "root", 2),
      message("b-2", "b-1", 1),
      message("b-3", "b-2", 1),
      message("b-4", "b-3", 1),
      message("b-fork", "b-4", 1),
      message("b-left-1", "b-fork", 1),
      message("b-left-2", "b-left-1", 1),
      message("b-mid-1", "b-fork", 2),
      message("b-right-1", "b-fork", 3),
      message("b-right-leaf-1", "b-right-1", 1),
      message("b-right-leaf-2", "b-right-1", 2),
      // Branch C: unbranched medium chain with 2 sub-branches
      message("c-1", "root", 3),
      message("c-sub-1", "c-1", 1),
      message("c-sub-2", "c-1", 2),
      message("c-sub-2-child", "c-sub-2", 1),
      message("c-sub-2-grand", "c-sub-2-child", 1),
      message("c-sub-2-leaf", "c-sub-2-grand", 1),
      // Second root tree
      message("root-2", null, 4),
      message("r2-child-1", "root-2", 1),
      message("r2-child-2", "root-2", 2)
    ];

    const model = buildForest(msgs);
    const display = buildDisplayForest(model, {
      expandedIds: allExpandableNodeIds(model),
      compressChains: true,
      activePathIds: ["root", "b-1", "b-2", "b-3", "b-4", "b-fork", "b-mid-1"],
      activeLeafId: "b-mid-1"
    });
    const layout = layoutCanvasForest(display.roots);

    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const yOverlap = a.y < b.y + b.height && b.y < a.y + a.height;
        if (yOverlap) {
          const horizontalGap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));
          expect(horizontalGap).toBeGreaterThanOrEqual(CANVAS_H_GAP - 0.1);
        }
      }
    }

    const activeEdges = layout.edges.filter((edge) => edge.isActivePath);
    expect(activeEdges.map((e) => e.id)).toEqual([
      "root->chain:b-1",
      "chain:b-1->b-fork",
      "b-fork->b-mid-1"
    ]);
  });
});

describe("Metro branch track layout (layoutMetroForest)", () => {
  it("pins the active path strictly to lane 0, forks side branches to lanes >= 1, and reuses freed lanes", () => {
    const msgs = [
      message("root", null, 1),
      message("old-swipe", "root", 1),
      message("old-swipe-leaf", "old-swipe", 1),
      message("active-turn", "root", 2),
      message("later-side", "active-turn", 1),
      message("active-leaf", "active-turn", 2)
    ];
    const model = buildForest(msgs);
    const display = buildDisplayForest(model, {
      expandedIds: allExpandableNodeIds(model),
      compressChains: false,
      activePathIds: ["root", "active-turn", "active-leaf"],
      activeLeafId: "active-leaf"
    });
    const metro = layoutMetroForest(display.roots);

    const byId = new Map(metro.rows.map((row) => [row.id, row]));
    expect(byId.get("root")?.lane).toBe(0);
    expect(byId.get("active-turn")?.lane).toBe(0);
    expect(byId.get("active-leaf")?.lane).toBe(0);

    expect(byId.get("old-swipe")?.lane).toBe(1);
    expect(byId.get("old-swipe-leaf")?.lane).toBe(1);
    // Lane 1 was freed after old-swipe-leaf, so later-side reuses lane 1 instead of growing wider.
    expect(byId.get("later-side")?.lane).toBe(1);
    expect(metro.laneCount).toBe(2);
  });

  it("keeps lane count at 1 across a 100-turn deep linear chain and moves focus with ArrowUp/ArrowDown", () => {
    const deepChain = Array.from({ length: 100 }, (_, idx) =>
      message(`d-${idx}`, idx === 0 ? null : `d-${idx - 1}`, 1)
    );
    const model = buildForest(deepChain);
    const display = buildDisplayForest(model, {
      expandedIds: allExpandableNodeIds(model),
      compressChains: false,
      activePathIds: deepChain.map((m) => m.id),
      activeLeafId: "d-99"
    });
    const metro = layoutMetroForest(display.roots);
    expect(metro.laneCount).toBe(1);
    expect(metro.rows.every((row) => row.lane === 0)).toBe(true);

    expect(moveMetroFocusIndex(0, 5, "ArrowDown")).toBe(1);
    expect(moveMetroFocusIndex(4, 5, "ArrowDown")).toBe(4);
    expect(moveMetroFocusIndex(2, 5, "ArrowUp")).toBe(1);
    expect(moveMetroFocusIndex(0, 5, "ArrowUp")).toBe(0);
    expect(moveMetroFocusIndex(1, 5, "End")).toBe(4);
    expect(moveMetroFocusIndex(3, 5, "Home")).toBe(0);
    expect(moveMetroFocusIndex(2, 5, "Enter")).toBeNull();
  });
});
