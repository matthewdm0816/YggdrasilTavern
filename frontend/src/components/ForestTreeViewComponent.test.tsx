import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message, SessionTree } from "../lib/api";
import { ForestTreeDialog, ForestTreeView, buildForest } from "./ForestTreeView";
import {
  createInitialForestTreeState,
  executeContinueFromNode,
  executeSelectNode,
  forestTreeReducer,
  type ContinueFromHandler,
  type ForestTreeAction
} from "../features/tree/treeState";

function makeMessage(
  id: string,
  parentId: string | null,
  order: number,
  overrides: Partial<Message> = {}
): Message {
  return {
    id,
    session_id: "session-1",
    parent_id: parentId,
    selected_child_id: null,
    role: order % 2 === 0 ? "user" : "assistant",
    speaker: order % 2 === 0 ? "Owner" : "Apeiria",
    content: `Content of ${id}`,
    thinking_content: "",
    status: "complete",
    token_count: 10,
    thinking_token_count: 0,
    cached_tokens: 0,
    sort_order: order,
    provider_metadata: {},
    usage: {},
    created_at: `2026-11-15T00:00:0${order % 10}`,
    updated_at: `2026-11-15T00:00:0${order % 10}`,
    ...overrides
  };
}

function sampleBranchingTree(): SessionTree {
  const messages = [
    makeMessage("root", null, 1, { content: "Greeting at tavern" }),
    makeMessage("m-1", "root", 1),
    makeMessage("m-2", "m-1", 1),
    makeMessage("m-3", "m-2", 1, {
      content: "Visible reply",
      thinking_content: "Hidden reasoning step about starlight"
    }),
    makeMessage("fork", "m-3", 1, { content: "Choose a path" }),
    makeMessage("active-leaf", "fork", 1, {
      content: "Active destination",
      thinking_content: "Deliberating active route"
    }),
    makeMessage("side-leaf", "fork", 2, { content: "Side branch destination" })
  ];
  return {
    session: { id: "session-1", title: "Test Session", preset: {} },
    messages,
    active_path_ids: ["root", "m-1", "m-2", "m-3", "fork", "active-leaf"]
  };
}

function stubViewportMedia(isMobile: boolean) {
  vi.stubGlobal("window", {
    matchMedia: vi.fn((query: string) => ({
      matches: query === "(max-width: 920px)" ? isMobile : !isMobile,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }))
  });
}

function createDialogHarness(options: {
  tree?: SessionTree;
  isMobile?: boolean;
  canContinue?: boolean;
  onSelectMessage?: (messageId: string) => Promise<void>;
  onContinueFrom?: ContinueFromHandler;
  onClose?: () => void;
} = {}) {
  const tree = options.tree ?? sampleBranchingTree();
  const model = buildForest(tree.messages);
  let state = createInitialForestTreeState(model);
  const onClose = options.onClose ?? vi.fn();
  const onSelectMessage = options.onSelectMessage ?? vi.fn(async () => undefined);
  const onContinueFrom = options.onContinueFrom ?? vi.fn(() => true);
  const canContinue = options.canContinue ?? true;
  const isMobile = options.isMobile ?? false;

  const dispatch = (action: ForestTreeAction) => {
    state = forestTreeReducer(state, action);
  };

  const render = () =>
    renderToStaticMarkup(
      <ForestTreeDialog
        tree={tree}
        model={model}
        state={state}
        dispatch={dispatch}
        isMobile={isMobile}
        canHover={!isMobile}
        onClose={onClose}
        onSelectMessage={onSelectMessage}
        onContinueFrom={onContinueFrom}
        canContinue={canContinue}
      />
    );

  return {
    tree,
    getState: () => state,
    dispatch,
    render,
    onClose,
    onSelectMessage,
    onContinueFrom,
    selectNode: (messageId: string, forceJump = false) =>
      executeSelectNode({
        messageId,
        pinnedId: state.pinnedId,
        selectingId: state.selectingId,
        forceJump,
        onSelectMessage,
        onClose,
        dispatch
      }),
    continueFrom: (messageId: string, isStreaming = false) =>
      executeContinueFromNode({
        messageId,
        canContinue,
        isStreaming,
        continuingId: state.continuingId,
        onContinueFrom,
        dispatch
      })
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ForestTreeView dual-mode defaults and mode switching", () => {
  it("defaults to canvas topology mode on desktop (> 920px) and metro track mode on mobile (<= 920px)", () => {
    const tree = sampleBranchingTree();

    stubViewportMedia(false);
    const desktopHtml = renderToStaticMarkup(
      <ForestTreeView
        tree={tree}
        onClose={() => undefined}
        onSelectMessage={async () => undefined}
        onContinueFrom={() => undefined}
        canContinue={true}
      />
    );
    expect(desktopHtml).toContain('data-view-mode="canvas"');
    expect(desktopHtml).toContain('aria-label="纵向拓扑画布"');
    expect(desktopHtml).toContain('class="ftv-canvas-edges"');
    expect(desktopHtml).toContain("适应画布");
    expect(desktopHtml).toContain('class="ftv-preview-panel"');

    stubViewportMedia(true);
    const mobileHtml = renderToStaticMarkup(
      <ForestTreeView
        tree={tree}
        onClose={() => undefined}
        onSelectMessage={async () => undefined}
        onContinueFrom={() => undefined}
        canContinue={true}
      />
    );
    expect(mobileHtml).toContain('data-view-mode="metro"');
    expect(mobileHtml).toContain('aria-label="分支轨道列表"');
    expect(mobileHtml).toContain('class="ftv-metro-svg"');
    // Mobile does not render the permanent side preview split before pinning a node.
    expect(mobileHtml).not.toContain('class="ftv-preview-panel"');
    expect(mobileHtml).not.toContain('class="ftv-bottom-sheet"');
  });

  it("allows switching freely between canvas and metro modes and toggles single-line chain capsules", () => {
    const harness = createDialogHarness({ isMobile: false });

    let html = harness.render();
    expect(html).toContain('data-view-mode="canvas"');
    expect(html).toContain("↕ 折叠 3 条连续对话 · 点击展开");
    expect(html).not.toContain('data-message-id="m-2"');

    // Expand that individual chain segment and verify interior nodes + re-collapse pill appear.
    harness.dispatch({ type: "expandChainSegment", nodeIds: ["m-1", "m-2", "m-3"] });
    html = harness.render();
    expect(html).toContain('data-message-id="m-1"');
    expect(html).toContain('data-message-id="m-2"');
    expect(html).toContain('data-message-id="m-3"');
    expect(html).toContain("↕ 收起 3 条");

    // Collapse the segment back into a capsule.
    harness.dispatch({ type: "collapseChainSegment", nodeIds: ["m-1", "m-2", "m-3"] });
    html = harness.render();
    expect(html).toContain("↕ 折叠 3 条连续对话 · 点击展开");
    expect(html).not.toContain('data-message-id="m-2"');

    // Switch to metro mode and toggle global chain compression off.
    harness.dispatch({ type: "setMode", mode: "metro" });
    harness.dispatch({ type: "toggleCompressChains" });
    html = harness.render();
    expect(html).toContain('data-view-mode="metro"');
    expect(html).toContain('aria-label="分支轨道列表"');
    expect(html).toContain('data-message-id="m-2"');
    expect(html).not.toContain("折叠 3 条连续对话");
  });
});

describe("Thinking content preview, search expansion, and mobile bottom sheet", () => {
  it("displays thinking_content in preview and auto-expands + highlights when search hits thinking_content", () => {
    const harness = createDialogHarness({ isMobile: false });

    // Default preview shows active-leaf including its thinking_content block.
    let html = harness.render();
    expect(html).toContain("思考过程");
    expect(html).toContain("Deliberating active route");

    // Search for "starlight" which lives inside m-3's thinking_content (currently inside compressed chain m-1..m-3).
    harness.dispatch({ type: "setSearchQuery", query: "starlight" });
    harness.dispatch({ type: "pinNode", id: "m-3" });
    html = harness.render();

    // m-3 breaks out of the compressed capsule and highlights "starlight" in the opened thinking preview.
    expect(html).toContain('data-message-id="m-3"');
    expect(html).toContain("搜索命中");
    expect(html).toContain('<details class="ftv-thinking-box" open="">');
    expect(html).toContain('<mark class="ftv-highlight">starlight</mark>');
  });

  it("opens a closable Bottom Sheet on mobile when pinning a node and jumps on second click", async () => {
    const onSelectMessage = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const harness = createDialogHarness({
      isMobile: true,
      onSelectMessage,
      onClose
    });

    expect(harness.render()).not.toContain('class="ftv-bottom-sheet"');

    // First click pins side-leaf and opens the mobile Bottom Sheet.
    const firstOutcome = await harness.selectNode("side-leaf");
    expect(firstOutcome).toBe("pinned");
    const sheetHtml = harness.render();
    expect(sheetHtml).toContain('class="ftv-bottom-sheet"');
    expect(sheetHtml).toContain("Side branch destination");
    expect(sheetHtml).toContain("跳转到此节点");
    expect(sheetHtml).toContain("从这里继续生成");
    expect(onSelectMessage).not.toHaveBeenCalled();

    // Closing the Bottom Sheet unpins the node and restores full-screen tree space.
    harness.dispatch({ type: "pinNode", id: null });
    expect(harness.render()).not.toContain('class="ftv-bottom-sheet"');

    // Pin again, then click a second time to jump and close the tree dialog.
    await harness.selectNode("side-leaf");
    const secondOutcome = await harness.selectNode("side-leaf");
    expect(secondOutcome).toBe("jumped");
    expect(onSelectMessage).toHaveBeenCalledWith("side-leaf");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Continue-from false-success prevention", () => {
  it("blocks false success and displays selectionError when onContinueFrom returns false", async () => {
    const onContinueFrom = vi.fn(async () => false);
    const harness = createDialogHarness({ onContinueFrom });

    await harness.selectNode("active-leaf");
    const started = await harness.continueFrom("active-leaf");

    expect(started).toBe(false);
    expect(onContinueFrom).toHaveBeenCalledWith("active-leaf");
    expect(harness.getState().continuedFromId).toBeNull();

    const html = harness.render();
    expect(html).not.toContain("已开始在这里生成新回复");
    expect(html).toContain('role="alert"');
    expect(html).toContain("无法从所选节点继续生成");
  });

  it("blocks false success and exposes detailed reason when onContinueFrom throws an error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const onContinueFrom = vi.fn(async () => {
      throw new Error("并发生成任务已达上限（4/4）");
    });
    const harness = createDialogHarness({ onContinueFrom });

    await harness.selectNode("active-leaf");
    const started = await harness.continueFrom("active-leaf");

    expect(started).toBe(false);
    expect(harness.getState().continuedFromId).toBeNull();
    expect(consoleSpy).toHaveBeenCalledOnce();

    const html = harness.render();
    expect(html).not.toContain("已开始在这里生成新回复");
    expect(html).toContain("无法从所选节点继续生成：并发生成任务已达上限（4/4）");
  });

  it("shows confirmation when onContinueFrom succeeds and clears stale confirmation if a retry fails", async () => {
    let shouldSucceed = true;
    const onContinueFrom = vi.fn(async () => shouldSucceed);
    const harness = createDialogHarness({ onContinueFrom });

    await harness.selectNode("active-leaf");
    expect(await harness.continueFrom("active-leaf")).toBe(true);
    let html = harness.render();
    expect(html).toContain("已开始在这里生成新回复");
    expect(html).not.toContain("无法从所选节点继续生成");

    // Second attempt fails with false -> must clear previous success message and show error banner.
    shouldSucceed = false;
    expect(await harness.continueFrom("active-leaf")).toBe(false);
    html = harness.render();
    expect(html).not.toContain("已开始在这里生成新回复");
    expect(html).toContain("无法从所选节点继续生成");
  });
});
