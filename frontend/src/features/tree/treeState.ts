import { ForestModel, allExpandableNodeIds, shouldJumpToNode } from "./treeModel";

export type TreeViewMode = "canvas" | "metro";

export type ContinueFromHandler = (messageId: string) => Promise<boolean | void> | boolean | void;

export type ForestTreeState = {
  modeOverride: TreeViewMode | null;
  expandedIds: Set<string>;
  compressChains: boolean;
  expandedChainNodeIds: Set<string>;
  searchQuery: string;
  hoveredId: string | null;
  focusedId: string | null;
  pinnedId: string | null;
  selectingId: string | null;
  continuingId: string | null;
  selectionError: string | null;
  continuedFromId: string | null;
};

export type ForestTreeAction =
  | { type: "setMode"; mode: TreeViewMode }
  | { type: "setSearchQuery"; query: string }
  | { type: "setHovered"; id: string | null }
  | { type: "setFocused"; id: string | null }
  | { type: "pinNode"; id: string | null }
  | { type: "toggleSubtree"; id: string }
  | { type: "expandSubtrees"; ids: Iterable<string> }
  | { type: "replaceExpandedSubtrees"; ids: Set<string> }
  | { type: "toggleCompressChains" }
  | { type: "expandChainSegment"; nodeIds: readonly string[] }
  | { type: "collapseChainSegment"; nodeIds: readonly string[] }
  | { type: "selectStart"; id: string }
  | { type: "selectFinish" }
  | { type: "selectFailed"; error: string }
  | { type: "continueStart"; id: string }
  | { type: "continueSucceeded"; id: string }
  | { type: "continueFailed"; error: string }
  | { type: "locateActivePath"; activeExpandedIds: Iterable<string>; activeLeafId: string };

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function resolveTreeViewMode(modeOverride: TreeViewMode | null, isMobile: boolean): TreeViewMode {
  if (modeOverride) return modeOverride;
  return isMobile ? "metro" : "canvas";
}

export function createInitialForestTreeState(model: ForestModel): ForestTreeState {
  return {
    modeOverride: null,
    expandedIds: allExpandableNodeIds(model),
    compressChains: true,
    expandedChainNodeIds: new Set<string>(),
    searchQuery: "",
    hoveredId: null,
    focusedId: null,
    pinnedId: null,
    selectingId: null,
    continuingId: null,
    selectionError: null,
    continuedFromId: null
  };
}

export function forestTreeReducer(state: ForestTreeState, action: ForestTreeAction): ForestTreeState {
  switch (action.type) {
    case "setMode":
      return { ...state, modeOverride: action.mode };
    case "setSearchQuery":
      return { ...state, searchQuery: action.query };
    case "setHovered":
      return state.hoveredId === action.id ? state : { ...state, hoveredId: action.id };
    case "setFocused":
      return state.focusedId === action.id ? state : { ...state, focusedId: action.id };
    case "pinNode":
      return { ...state, pinnedId: action.id, selectionError: null };
    case "toggleSubtree": {
      const next = new Set(state.expandedIds);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { ...state, expandedIds: next };
    }
    case "expandSubtrees": {
      const next = new Set(state.expandedIds);
      let changed = false;
      for (const id of action.ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? { ...state, expandedIds: next } : state;
    }
    case "replaceExpandedSubtrees":
      return { ...state, expandedIds: new Set(action.ids) };
    case "toggleCompressChains":
      return {
        ...state,
        compressChains: !state.compressChains,
        expandedChainNodeIds: new Set<string>()
      };
    case "expandChainSegment": {
      const next = new Set(state.expandedChainNodeIds);
      for (const id of action.nodeIds) next.add(id);
      return { ...state, expandedChainNodeIds: next };
    }
    case "collapseChainSegment": {
      const next = new Set(state.expandedChainNodeIds);
      for (const id of action.nodeIds) next.delete(id);
      return { ...state, expandedChainNodeIds: next };
    }
    case "selectStart":
      return { ...state, selectingId: action.id, selectionError: null };
    case "selectFinish":
      return { ...state, selectingId: null };
    case "selectFailed":
      return { ...state, selectingId: null, selectionError: action.error };
    case "continueStart":
      return {
        ...state,
        continuingId: action.id,
        selectionError: null,
        continuedFromId: null
      };
    case "continueSucceeded":
      return {
        ...state,
        continuingId: null,
        selectionError: null,
        continuedFromId: action.id
      };
    case "continueFailed":
      return {
        ...state,
        continuingId: null,
        continuedFromId: null,
        selectionError: action.error
      };
    case "locateActivePath": {
      const next = new Set(state.expandedIds);
      for (const id of action.activeExpandedIds) next.add(id);
      return {
        ...state,
        searchQuery: "",
        expandedIds: next,
        focusedId: action.activeLeafId
      };
    }
  }
}

export async function executeSelectNode(options: {
  messageId: string;
  pinnedId: string | null;
  selectingId: string | null;
  forceJump?: boolean;
  onSelectMessage: (messageId: string) => Promise<void>;
  onClose: () => void;
  dispatch: (action: ForestTreeAction) => void;
  onPinned?: (messageId: string) => void;
}): Promise<"pinned" | "jumped" | "failed" | "busy"> {
  const { messageId, pinnedId, selectingId, forceJump = false, onSelectMessage, onClose, dispatch, onPinned } = options;
  if (selectingId) return "busy";

  if (!forceJump && !shouldJumpToNode(pinnedId, messageId)) {
    dispatch({ type: "pinNode", id: messageId });
    onPinned?.(messageId);
    return "pinned";
  }

  dispatch({ type: "selectStart", id: messageId });
  try {
    await onSelectMessage(messageId);
    dispatch({ type: "selectFinish" });
    onClose();
    return "jumped";
  } catch (cause) {
    const detail = errorMessage(cause);
    dispatch({ type: "selectFailed", error: `无法跳转到所选节点：${detail}` });
    console.error("Forest Tree View 跳转失败", cause);
    return "failed";
  }
}

export async function executeContinueFromNode(options: {
  messageId: string;
  canContinue: boolean;
  isStreaming: boolean;
  continuingId: string | null;
  onContinueFrom: ContinueFromHandler;
  dispatch: (action: ForestTreeAction) => void;
}): Promise<boolean> {
  const { messageId, canContinue, isStreaming, continuingId, onContinueFrom, dispatch } = options;
  if (continuingId || !canContinue || isStreaming) return false;

  dispatch({ type: "continueStart", id: messageId });
  try {
    const outcome = await onContinueFrom(messageId);
    if (outcome === false) {
      dispatch({
        type: "continueFailed",
        error: "无法从所选节点继续生成：生成请求未能启动（请检查模型配置、并发生成上限或当前会话状态）。"
      });
      return false;
    }
    dispatch({ type: "continueSucceeded", id: messageId });
    return true;
  } catch (cause) {
    const detail = errorMessage(cause);
    dispatch({
      type: "continueFailed",
      error: `无法从所选节点继续生成：${detail}`
    });
    console.error("Forest Tree View 继续生成失败", cause);
    return false;
  }
}
