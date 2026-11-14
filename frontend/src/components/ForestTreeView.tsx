import "../styles/forest-tree.css";
import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsDownUp,
  ChevronsUp,
  ChevronsUpDown,
  GitBranch,
  LocateFixed,
  Maximize2,
  Minus,
  Network,
  Plus,
  Search,
  Sparkles,
  X
} from "lucide-react";
import { Message, SessionTree } from "../lib/api";
import { displayMessageText, type MacroContext } from "../lib/macros";
import { messageErrorText, messageStatusLabel } from "../lib/messageStatus";
import { useMediaQuery } from "../lib/useMediaQuery";
import { useMessageMacroContext } from "./MessageMacroProvider";
import {
  activePathExpandedNodeIds,
  allExpandableNodeIds,
  buildDisplayForest,
  buildForest,
  highlightTextSegments,
  messageSummary,
  roleLabel,
  shouldJumpToNode,
  thinkingMatchesQuery,
  visibleForestRows,
  type DisplayChainItem,
  type DisplayMessageItem,
  type ForestModel,
  type ForestNode,
  type VisibleForestRow
} from "../features/tree/treeModel";
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  CANVAS_ZOOM_STEP,
  centerCanvasOnNode,
  clampCanvasZoom,
  fitCanvasToViewport,
  layoutCanvasForest,
  type CanvasViewport
} from "../features/tree/canvasLayout";
import {
  layoutMetroForest,
  metroGutterWidth,
  metroLaneCenterX,
  metroSegmentPath,
  moveMetroFocusIndex,
  type MetroRow
} from "../features/tree/metroLayout";
import {
  createInitialForestTreeState,
  executeContinueFromNode,
  executeSelectNode,
  forestTreeReducer,
  resolveTreeViewMode,
  type ContinueFromHandler,
  type ForestTreeAction,
  type ForestTreeState,
  type TreeViewMode
} from "../features/tree/treeState";

export {
  activePathExpandedNodeIds,
  allExpandableNodeIds,
  buildDisplayForest,
  buildForest,
  layoutCanvasForest,
  layoutMetroForest,
  moveMetroFocusIndex,
  shouldJumpToNode,
  visibleForestRows
};
export type {
  DisplayChainItem,
  DisplayMessageItem,
  ForestModel,
  ForestNode,
  TreeViewMode,
  VisibleForestRow
};

type Props = {
  tree: SessionTree;
  onClose: () => void;
  onSelectMessage: (messageId: string) => Promise<void>;
  /** Start a new reply below a node while the tree stays open. */
  onContinueFrom: ContinueFromHandler;
  canContinue: boolean;
};

export type ForestTreeDialogProps = Props & {
  model: ForestModel;
  state: ForestTreeState;
  dispatch: (action: ForestTreeAction) => void;
  isMobile: boolean;
  canHover: boolean;
  macroContext?: MacroContext;
};

const DRAG_THRESHOLD_PX = 6;

function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const segments = useMemo(() => highlightTextSegments(text, query), [text, query]);
  return (
    <>
      {segments.map((seg, index) =>
        seg.matched ? (
          <mark key={index} className="ftv-highlight">
            {seg.text}
          </mark>
        ) : (
          <span key={index}>{seg.text}</span>
        )
      )}
    </>
  );
}

function chainSpeakersLabel(chain: DisplayChainItem): string {
  const first = chain.messages[0];
  const last = chain.messages[chain.messages.length - 1];
  const firstSpeaker = first ? first.speaker || roleLabel(first.role) : "";
  const lastSpeaker = last ? last.speaker || roleLabel(last.role) : "";
  const firstSnippet = first ? messageSummary(first, undefined, 26) : "";
  return `${firstSpeaker}「${firstSnippet}」→ ${lastSpeaker}`;
}

export function ForestTreeDialog({
  tree,
  model,
  state,
  dispatch,
  isMobile,
  canHover,
  macroContext,
  onClose,
  onSelectMessage,
  onContinueFrom,
  canContinue
}: ForestTreeDialogProps) {
  const titleId = useId();
  const previewId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const metroScrollRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const suppressClickUntilRef = useRef(0);
  const panGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  const [viewport, setViewport] = useState<CanvasViewport>({ x: 28, y: 18, zoom: 1 });
  const [smoothStage, setSmoothStage] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const initializedCanvasRef = useRef(false);

  const viewMode = resolveTreeViewMode(state.modeOverride, isMobile);
  const messagesById = useMemo(
    () => new Map(tree.messages.map((message) => [message.id, message])),
    [tree.messages]
  );
  const activePath = useMemo(() => new Set(tree.active_path_ids), [tree.active_path_ids]);
  const activeLeafId = useMemo(() => {
    for (let index = tree.active_path_ids.length - 1; index >= 0; index -= 1) {
      const messageId = tree.active_path_ids[index];
      if (messagesById.has(messageId)) return messageId;
    }
    return null;
  }, [messagesById, tree.active_path_ids]);

  const firstRootId = model.roots[0]?.message.id || null;
  const desktopShownId =
    state.hoveredId || state.focusedId || state.pinnedId || activeLeafId || firstRootId;
  const shownMessage = isMobile
    ? state.pinnedId
      ? messagesById.get(state.pinnedId)
      : undefined
    : desktopShownId
      ? messagesById.get(desktopShownId)
      : undefined;

  const displayForest = useMemo(
    () =>
      buildDisplayForest(model, {
        expandedIds: state.expandedIds,
        compressChains: state.compressChains,
        expandedChainNodeIds: state.expandedChainNodeIds,
        activePathIds: tree.active_path_ids,
        activeLeafId,
        pinnedId: state.pinnedId,
        searchQuery: state.searchQuery,
        macroContext
      }),
    [
      activeLeafId,
      macroContext,
      model,
      state.compressChains,
      state.expandedChainNodeIds,
      state.expandedIds,
      state.pinnedId,
      state.searchQuery,
      tree.active_path_ids
    ]
  );

  const canvasLayout = useMemo(
    () => (viewMode === "canvas" ? layoutCanvasForest(displayForest.roots) : null),
    [displayForest.roots, viewMode]
  );

  const metroLayout = useMemo(
    () => (viewMode === "metro" ? layoutMetroForest(displayForest.roots) : null),
    [displayForest.roots, viewMode]
  );

  const hiddenSubtreeNodeCount = Math.max(
    0,
    tree.messages.length - displayForest.totalVisibleMessages
  );

  // Focus trap & Escape handling (closes mobile Bottom Sheet first if open).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.getElementById("root");
    const wasInert = background?.inert || false;
    if (background) background.inert = true;
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const dialog = closeButtonRef.current?.closest(".forest-tree-dialog");
        const controls = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex='0']"
          ) || []
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (isMobile && state.pinnedId) {
        dispatch({ type: "pinNode", id: null });
        return;
      }
      onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (background) background.inert = wasInert;
      previouslyFocused?.focus();
    };
  }, [dispatch, isMobile, onClose, state.pinnedId]);

  // Center initial canvas viewport on activeLeafId (or first root) when canvas mounts.
  useEffect(() => {
    if (viewMode !== "canvas" || !canvasLayout || canvasLayout.nodes.length === 0) return;
    if (initializedCanvasRef.current) return;
    const viewportEl = canvasViewportRef.current;
    if (!viewportEl || viewportEl.clientWidth <= 0) return;
    initializedCanvasRef.current = true;
    const target =
      (activeLeafId ? canvasLayout.nodesById.get(activeLeafId) : undefined) ||
      (firstRootId ? canvasLayout.nodesById.get(firstRootId) : undefined) ||
      canvasLayout.nodes[0];
    if (target) {
      setSmoothStage(false);
      setViewport(
        centerCanvasOnNode(target, viewportEl.clientWidth, viewportEl.clientHeight, 1)
      );
    }
  }, [activeLeafId, canvasLayout, firstRootId, viewMode]);

  // Non-passive wheel zoom anchored around pointer cursor on the topology canvas.
  useEffect(() => {
    if (viewMode !== "canvas") return;
    const viewportEl = canvasViewportRef.current;
    if (!viewportEl) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const rect = viewportEl!.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;

      setSmoothStage(false);
      setViewport((prev) => {
        const nextZoom = clampCanvasZoom(prev.zoom * factor);
        if (nextZoom === prev.zoom) return prev;
        const worldX = (cursorX - prev.x) / prev.zoom;
        const worldY = (cursorY - prev.y) / prev.zoom;
        return {
          x: Math.round(cursorX - worldX * nextZoom),
          y: Math.round(cursorY - worldY * nextZoom),
          zoom: nextZoom
        };
      });
    }

    viewportEl.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewportEl.removeEventListener("wheel", handleWheel);
  }, [viewMode]);

  function zoomByStep(delta: number) {
    const viewportEl = canvasViewportRef.current;
    const centerX = viewportEl ? viewportEl.clientWidth / 2 : 360;
    const centerY = viewportEl ? viewportEl.clientHeight / 2 : 280;
    setSmoothStage(true);
    setViewport((prev) => {
      const nextZoom = clampCanvasZoom(prev.zoom + delta);
      const worldX = (centerX - prev.x) / prev.zoom;
      const worldY = (centerY - prev.y) / prev.zoom;
      return {
        x: Math.round(centerX - worldX * nextZoom),
        y: Math.round(centerY - worldY * nextZoom),
        zoom: nextZoom
      };
    });
  }

  function resetZoomTo100() {
    const viewportEl = canvasViewportRef.current;
    const centerX = viewportEl ? viewportEl.clientWidth / 2 : 360;
    const centerY = viewportEl ? viewportEl.clientHeight / 2 : 280;
    setSmoothStage(true);
    setViewport((prev) => {
      const worldX = (centerX - prev.x) / prev.zoom;
      const worldY = (centerY - prev.y) / prev.zoom;
      return {
        x: Math.round(centerX - worldX),
        y: Math.round(centerY - worldY),
        zoom: 1
      };
    });
  }

  function fitCanvas() {
    if (!canvasLayout) return;
    const viewportEl = canvasViewportRef.current;
    if (!viewportEl) return;
    setSmoothStage(true);
    setViewport(
      fitCanvasToViewport(canvasLayout, viewportEl.clientWidth, viewportEl.clientHeight)
    );
  }

  function locateCurrentNode() {
    if (!activeLeafId) return;
    dispatch({
      type: "locateActivePath",
      activeExpandedIds: activePathExpandedNodeIds(model, tree.active_path_ids),
      activeLeafId
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (viewMode === "canvas") {
          const viewportEl = canvasViewportRef.current;
          const fullForest = buildDisplayForest(model, {
            expandedIds: new Set([
              ...state.expandedIds,
              ...activePathExpandedNodeIds(model, tree.active_path_ids)
            ]),
            compressChains: state.compressChains,
            expandedChainNodeIds: state.expandedChainNodeIds,
            activePathIds: tree.active_path_ids,
            activeLeafId,
            pinnedId: state.pinnedId,
            searchQuery: "",
            macroContext
          });
          const nextLayout = layoutCanvasForest(fullForest.roots);
          const placed = nextLayout.nodesById.get(activeLeafId);
          if (placed && viewportEl) {
            setSmoothStage(true);
            setViewport((prev) =>
              centerCanvasOnNode(
                placed,
                viewportEl.clientWidth,
                viewportEl.clientHeight,
                prev.zoom
              )
            );
          }
          itemRefs.current.get(activeLeafId)?.focus({ preventScroll: true });
        } else {
          const element = itemRefs.current.get(activeLeafId);
          element?.scrollIntoView({
            block: "center",
            inline: "nearest",
            behavior: scrollBehavior()
          });
          element?.focus({ preventScroll: true });
        }
      })
    );
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as HTMLElement | null)?.closest(".ftv-zoom-dock")) return;
    panGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      moved: false
    };
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      gesture.moved = true;
      setIsPanning(true);
      setSmoothStage(false);
      canvasViewportRef.current?.setPointerCapture(event.pointerId);
    }
    setViewport((prev) => ({
      ...prev,
      x: Math.round(gesture.originX + dx),
      y: Math.round(gesture.originY + dy)
    }));
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = panGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (gesture.moved) {
      suppressClickUntilRef.current =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) + 80;
      if (canvasViewportRef.current?.hasPointerCapture(event.pointerId)) {
        canvasViewportRef.current.releasePointerCapture(event.pointerId);
      }
    }
    panGestureRef.current = null;
    setIsPanning(false);
  }

  function shouldIgnoreClickAfterPan(): boolean {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    return now < suppressClickUntilRef.current;
  }

  function handleNodeClick(message: Message, forceJump = false) {
    if (shouldIgnoreClickAfterPan()) return;
    void executeSelectNode({
      messageId: message.id,
      pinnedId: state.pinnedId,
      selectingId: state.selectingId,
      forceJump,
      onSelectMessage,
      onClose,
      dispatch
    });
  }

  function handleMetroKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    if (!metroLayout || metroLayout.rows.length === 0) return;
    const orderedIds = metroLayout.rows.map((row) => row.id);
    const activeEl = typeof document !== "undefined" ? document.activeElement : null;
    let currentIdx = orderedIds.findIndex((id) => itemRefs.current.get(id) === activeEl);
    if (currentIdx < 0 && state.focusedId) {
      currentIdx = orderedIds.indexOf(state.focusedId);
    }
    const nextIdx = moveMetroFocusIndex(currentIdx, orderedIds.length, event.key);
    if (nextIdx === null) return;
    event.preventDefault();
    const targetId = orderedIds[nextIdx];
    const targetButton = itemRefs.current.get(targetId);
    targetButton?.focus();
    targetButton?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }

  function renderCanvasNode(placed: NonNullable<typeof canvasLayout>["nodes"][number]) {
    const { item } = placed;
    if (item.kind === "chain") {
      return (
        <div
          key={item.id}
          className="ftv-canvas-node-slot"
          style={{
            left: `${placed.x}px`,
            top: `${placed.y}px`,
            width: `${placed.width}px`,
            height: `${placed.height}px`
          }}
        >
          <button
            ref={(el) => {
              if (el) itemRefs.current.set(item.id, el);
              else itemRefs.current.delete(item.id);
            }}
            type="button"
            className={`ftv-chain-capsule${item.isOnActivePath ? " active-path" : ""}`}
            data-chain-id={item.id}
            aria-expanded={false}
            aria-label={`展开折叠的 ${item.count} 条连续对话`}
            onClick={() => {
              if (shouldIgnoreClickAfterPan()) return;
              dispatch({ type: "expandChainSegment", nodeIds: item.nodeIds });
            }}
          >
            <span className="ftv-chain-title">
              <ChevronsUpDown size={13} aria-hidden="true" />
              <span>↕ 折叠 {item.count} 条连续对话 · 点击展开</span>
              {item.siblingCount > 1 && (
                <span className="ftv-mini-badge badge-branch">
                  {item.siblingIndex}/{item.siblingCount}
                </span>
              )}
            </span>
            <span className="ftv-chain-sub">{chainSpeakersLabel(item)}</span>
          </button>
        </div>
      );
    }

    const { message, children } = item.node;
    const summaryText = messageSummary(message, macroContext, 96);
    const hasThinking = Boolean(message.thinking_content.trim());
    const cardClasses = [
      "ftv-canvas-card",
      `role-${message.role}`,
      item.isOnActivePath ? "active-path" : "",
      item.isCurrent ? "current-node" : "",
      item.isPinned ? "pinned-preview" : "",
      item.isSearchMatch ? "search-match" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div
        key={item.id}
        className="ftv-canvas-node-slot"
        style={{
          left: `${placed.x}px`,
          top: `${placed.y}px`,
          width: `${placed.width}px`,
          height: `${placed.height}px`
        }}
      >
        {item.recollapseChain && (
          <button
            type="button"
            className="ftv-canvas-recollapse-btn"
            title={`收起这段 ${item.recollapseChain.count} 条连续对话`}
            aria-label={`收起 ${item.recollapseChain.count} 条连续对话`}
            onClick={() => {
              if (shouldIgnoreClickAfterPan()) return;
              dispatch({
                type: "collapseChainSegment",
                nodeIds: item.recollapseChain!.nodeIds
              });
            }}
          >
            ↕ 收起 {item.recollapseChain.count} 条
          </button>
        )}
        <button
          ref={(el) => {
            if (el) itemRefs.current.set(message.id, el);
            else itemRefs.current.delete(message.id);
          }}
          type="button"
          className={cardClasses}
          data-message-id={message.id}
          aria-current={item.isCurrent ? "true" : undefined}
          aria-pressed={item.isPinned}
          aria-controls={previewId}
          disabled={Boolean(state.selectingId)}
          onPointerEnter={(event) =>
            event.pointerType === "mouse" && dispatch({ type: "setHovered", id: message.id })
          }
          onPointerLeave={(event) =>
            event.pointerType === "mouse" &&
            state.hoveredId === message.id &&
            dispatch({ type: "setHovered", id: null })
          }
          onFocus={() => dispatch({ type: "setFocused", id: message.id })}
          onBlur={() =>
            state.focusedId === message.id && dispatch({ type: "setFocused", id: null })
          }
          onClick={() => handleNodeClick(message)}
        >
          <span className="ftv-card-head">
            <span className="ftv-card-identity">
              <span className={`ftv-role-pill role-${message.role}`}>
                {roleLabel(message.role)}
              </span>
              <span className="ftv-speaker">{message.speaker || roleLabel(message.role)}</span>
            </span>
            <span className="ftv-card-badges">
              {item.siblingCount > 1 && (
                <span
                  className="ftv-mini-badge badge-branch"
                  title={`同级第 ${item.siblingIndex} / ${item.siblingCount} 个分支`}
                >
                  {item.siblingIndex}/{item.siblingCount}
                </span>
              )}
              {hasThinking && (
                <span className="ftv-mini-badge badge-thinking" title="包含思考过程">
                  思考
                </span>
              )}
              {item.isCurrent ? (
                <span className="ftv-mini-badge badge-current">当前</span>
              ) : (
                message.status !== "complete" && (
                  <span className={`ftv-mini-badge status-${message.status}`}>
                    {messageStatusLabel(message.status)}
                  </span>
                )
              )}
            </span>
          </span>
          <span className="ftv-card-summary">
            <HighlightedText text={summaryText} query={state.searchQuery} />
          </span>
        </button>
        {children.length > 0 && !state.searchQuery.trim() && (
          <button
            type="button"
            className="ftv-canvas-subtree-btn"
            title={
              item.expanded
                ? "折叠此节点子树"
                : `展开子树（+${item.hiddenDescendantCount}）`
            }
            aria-label={
              item.expanded
                ? `折叠 ${message.speaker || roleLabel(message.role)} 的子树`
                : `展开 ${message.speaker || roleLabel(message.role)} 的子树，包含 ${item.hiddenDescendantCount} 个隐藏节点`
            }
            onClick={() => {
              if (shouldIgnoreClickAfterPan()) return;
              dispatch({ type: "toggleSubtree", id: message.id });
            }}
          >
            {item.expanded ? (
              <ChevronDown size={12} />
            ) : (
              <>
                <ChevronRight size={12} />
                <span>+{item.hiddenDescendantCount}</span>
              </>
            )}
          </button>
        )}
      </div>
    );
  }

  function renderMetroRow(row: MetroRow, gutterWidth: number) {
    const { item } = row;
    const dotClasses = [
      "ftv-metro-dot",
      `lane-color-${row.colorIndex}`,
      item.isOnActivePath ? "active-dot" : "",
      item.kind === "message" && item.isCurrent ? "current-dot" : "",
      item.kind === "chain" ? "chain-dot" : ""
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <li
        key={row.id}
        role="treeitem"
        aria-expanded={
          item.kind === "chain"
            ? false
            : item.node.children.length > 0
              ? item.expanded
              : undefined
        }
        className={`ftv-metro-row${item.kind === "chain" ? " is-chain-row" : ""}${row.isRootStart ? " root-separator" : ""}`}
      >
        <div
          className="ftv-metro-gutter"
          style={{ width: `${gutterWidth}px` }}
          aria-hidden="true"
        >
          <svg
            className="ftv-metro-svg"
            viewBox={`0 0 ${gutterWidth} 100`}
            preserveAspectRatio="none"
          >
            {row.segments.map((segment, segIdx) => {
              const d = metroSegmentPath(segment);
              return (
                <g key={segIdx}>
                  {segment.isActivePath && (
                    <path
                      d={d}
                      className="ftv-metro-rail lane-glow"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <path
                    d={d}
                    className={`ftv-metro-rail lane-color-${segment.colorIndex}`}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </svg>
          <span
            className={dotClasses}
            style={{ left: `${metroLaneCenterX(row.lane)}px` }}
          />
        </div>

        <div className="ftv-metro-card-cell">
          {item.kind === "chain" ? (
            <button
              ref={(el) => {
                if (el) itemRefs.current.set(item.id, el);
                else itemRefs.current.delete(item.id);
              }}
              type="button"
              className={`ftv-chain-capsule ftv-metro-chain-capsule${item.isOnActivePath ? " active-path" : ""}`}
              data-chain-id={item.id}
              aria-label={`展开折叠的 ${item.count} 条连续对话`}
              onClick={() =>
                dispatch({ type: "expandChainSegment", nodeIds: item.nodeIds })
              }
            >
              <span className="ftv-chain-title">
                <ChevronsUpDown size={14} aria-hidden="true" />
                <span>↕ 折叠 {item.count} 条连续对话 · 点击展开</span>
                {item.siblingCount > 1 && (
                  <span className="ftv-mini-badge badge-branch">
                    {item.siblingIndex}/{item.siblingCount}
                  </span>
                )}
              </span>
              <span className="ftv-chain-sub">{chainSpeakersLabel(item)}</span>
            </button>
          ) : (
            <>
              <button
                ref={(el) => {
                  if (el) itemRefs.current.set(item.id, el);
                  else itemRefs.current.delete(item.id);
                }}
                type="button"
                data-message-id={item.id}
                aria-current={item.isCurrent ? "true" : undefined}
                aria-pressed={item.isPinned}
                aria-controls={previewId}
                disabled={Boolean(state.selectingId)}
                className={[
                  "ftv-metro-card",
                  item.isOnActivePath ? "active-path" : "",
                  item.isCurrent ? "current-node" : "",
                  item.isPinned ? "pinned-preview" : "",
                  item.isSearchMatch ? "search-match" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                onPointerEnter={(event) =>
                  event.pointerType === "mouse" &&
                  dispatch({ type: "setHovered", id: item.id })
                }
                onPointerLeave={(event) =>
                  event.pointerType === "mouse" &&
                  state.hoveredId === item.id &&
                  dispatch({ type: "setHovered", id: null })
                }
                onFocus={() => dispatch({ type: "setFocused", id: item.id })}
                onBlur={() =>
                  state.focusedId === item.id &&
                  dispatch({ type: "setFocused", id: null })
                }
                onClick={() => handleNodeClick(item.node.message)}
              >
                <span className={`ftv-role-pill role-${item.node.message.role}`}>
                  {roleLabel(item.node.message.role)}
                </span>
                <span className="ftv-metro-copy">
                  <span className="ftv-speaker">
                    {item.node.message.speaker || roleLabel(item.node.message.role)}
                  </span>
                  <span className="ftv-metro-summary">
                    <HighlightedText
                      text={messageSummary(item.node.message, macroContext, 110)}
                      query={state.searchQuery}
                    />
                  </span>
                </span>
                <span className="ftv-card-badges">
                  {item.siblingCount > 1 && (
                    <span className="ftv-mini-badge badge-branch">
                      {item.siblingIndex}/{item.siblingCount}
                    </span>
                  )}
                  {Boolean(item.node.message.thinking_content.trim()) && (
                    <span className="ftv-mini-badge badge-thinking">思考</span>
                  )}
                  {item.isCurrent && (
                    <span className="ftv-mini-badge badge-current">当前</span>
                  )}
                  <span className={`ftv-mini-badge status-${item.node.message.status}`}>
                    {messageStatusLabel(item.node.message.status)}
                  </span>
                </span>
              </button>
              {(item.recollapseChain ||
                (item.node.children.length > 0 && !state.searchQuery.trim())) && (
                <div className="ftv-metro-side-controls">
                  {item.recollapseChain && (
                    <button
                      type="button"
                      className="ftv-inline-pill-btn"
                      title={`收起这段 ${item.recollapseChain.count} 条连续对话`}
                      aria-label={`收起 ${item.recollapseChain.count} 条连续对话`}
                      onClick={() =>
                        dispatch({
                          type: "collapseChainSegment",
                          nodeIds: item.recollapseChain!.nodeIds
                        })
                      }
                    >
                      ↕ 收起 {item.recollapseChain.count}
                    </button>
                  )}
                  {item.node.children.length > 0 && !state.searchQuery.trim() && (
                    <button
                      type="button"
                      className="ftv-inline-pill-btn"
                      title={
                        item.expanded
                          ? "折叠子树"
                          : `展开子树（+${item.hiddenDescendantCount}）`
                      }
                      aria-label={
                        item.expanded
                          ? `折叠 ${item.node.message.speaker || roleLabel(item.node.message.role)} 的子树`
                          : `展开 ${item.node.message.speaker || roleLabel(item.node.message.role)} 的子树`
                      }
                      onClick={() => dispatch({ type: "toggleSubtree", id: item.id })}
                    >
                      {item.expanded ? (
                        <ChevronDown size={14} />
                      ) : (
                        <>
                          <ChevronRight size={14} />
                          <span>+{item.hiddenDescendantCount}</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </li>
    );
  }

  function renderPreviewContent(target: Message, isPinnedTarget: boolean, withCloseButton: boolean) {
    const renderedBody = displayMessageText(target.content, macroContext);
    const renderedThinking = displayMessageText(target.thinking_content, macroContext).trim();
    const thinkingHit = thinkingMatchesQuery(target, state.searchQuery, macroContext);
    const defaultThinkingOpen = thinkingHit || !renderedBody.trim();

    return (
      <>
        <header className="ftv-preview-header">
          <div>
            <p className="eyebrow">分支预览</p>
            <h3>{target.speaker || roleLabel(target.role)}</h3>
          </div>
          <div className="ftv-preview-header-right">
            <div className="ftv-preview-badges">
              <span className="ftv-mini-badge">{roleLabel(target.role)}</span>
              <span className={`ftv-mini-badge status-${target.status}`}>
                {messageStatusLabel(target.status)}
              </span>
              {activePath.has(target.id) && (
                <span className="ftv-mini-badge badge-current">当前路径</span>
              )}
            </div>
            {withCloseButton && (
              <button
                type="button"
                className="icon-button"
                aria-label="关闭节点预览"
                title="关闭节点预览"
                onClick={() => dispatch({ type: "pinNode", id: null })}
              >
                <X size={16} />
              </button>
            )}
          </div>
        </header>

        <div className="ftv-preview-scroll">
          {renderedThinking && (
            <details
              key={`${target.id}:${defaultThinkingOpen ? "open" : "closed"}`}
              className="ftv-thinking-box"
              open={defaultThinkingOpen}
            >
              <summary>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "5px" }}>
                  <Brain size={14} aria-hidden="true" />
                  <span>思考过程</span>
                </span>
                {thinkingHit && (
                  <span className="ftv-mini-badge badge-thinking">搜索命中</span>
                )}
              </summary>
              <pre className="ftv-thinking-content">
                <HighlightedText text={renderedThinking} query={state.searchQuery} />
              </pre>
            </details>
          )}
          <pre className="ftv-preview-content">
            {renderedBody ? (
              <HighlightedText text={renderedBody} query={state.searchQuery} />
            ) : (
              "（空消息）"
            )}
          </pre>
          {target.error && (
            <div className="ftv-message-error" role="alert">
              节点错误：{messageErrorText(target.error)}
            </div>
          )}
        </div>

        <footer className="ftv-preview-footer">
          {isPinnedTarget ? (
            <>
              <p>预览已固定。再次点击同一节点，或点击下方按钮跳转。</p>
              <div className="ftv-preview-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={Boolean(state.selectingId)}
                  onClick={() => handleNodeClick(target, true)}
                >
                  <ArrowRight size={16} />
                  {state.selectingId === target.id ? "正在跳转…" : "跳转到此节点"}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={
                    !canContinue ||
                    target.status === "streaming" ||
                    Boolean(state.continuingId)
                  }
                  title={
                    target.status === "streaming"
                      ? "这条消息还在生成"
                      : "在这条消息下面生成一条新回复"
                  }
                  onClick={() =>
                    void executeContinueFromNode({
                      messageId: target.id,
                      canContinue,
                      isStreaming: target.status === "streaming",
                      continuingId: state.continuingId,
                      onContinueFrom,
                      dispatch
                    })
                  }
                >
                  <Sparkles size={16} />
                  {state.continuingId === target.id ? "正在启动…" : "从这里继续生成"}
                </button>
              </div>
              {state.continuedFromId === target.id && (
                <p className="ftv-continue-status" role="status">
                  已开始在这里生成新回复，它会作为这条消息的新分支出现；进度见聊天顶栏的生成状态。
                </p>
              )}
            </>
          ) : (
            <p>
              {state.pinnedId
                ? "这是临时预览；移开后会回到已固定节点。"
                : "点击树中的节点可固定这段完整预览并操作分支。"}
            </p>
          )}
        </footer>
      </>
    );
  }

  const gutterWidth = metroLayout ? metroGutterWidth(metroLayout.laneCount) : 32;

  return (
    <div
      className="forest-tree-backdrop ftv-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="forest-tree-dialog ftv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-view-mode={viewMode}
      >
        <header className="ftv-header">
          <div className="ftv-header-copy">
            <div className="ftv-title-row">
              <h2 id={titleId}>完整聊天树</h2>
              <p className="ftv-stats">
                {model.roots.length} 棵树 · {tree.messages.length} 个节点 · 当前路径{" "}
                {tree.active_path_ids.length} 个节点
              </p>
            </div>
            <p className="ftv-instructions">
              {viewMode === "canvas"
                ? canHover
                  ? "拖拽平移、滚轮缩放；悬停临时预览，点击一次固定预览，再点同一节点即可跳转。"
                  : "单指拖拽平移画布；点击节点查看预览并跳转。"
                : "主干固定在左侧第 0 轨，支持 ↑/↓ 方向键切换节点；点击一次固定预览，再点跳转。"}
            </p>
          </div>

          <div className="ftv-header-controls">
            <div className="ftv-mode-switch" role="group" aria-label="聊天树视图模式">
              <button
                type="button"
                className={`ftv-mode-btn${viewMode === "canvas" ? " active" : ""}`}
                aria-pressed={viewMode === "canvas"}
                onClick={() => dispatch({ type: "setMode", mode: "canvas" })}
              >
                <Network size={15} aria-hidden="true" />
                <span>拓扑画布</span>
              </button>
              <button
                type="button"
                className={`ftv-mode-btn${viewMode === "metro" ? " active" : ""}`}
                aria-pressed={viewMode === "metro"}
                onClick={() => dispatch({ type: "setMode", mode: "metro" })}
              >
                <GitBranch size={15} aria-hidden="true" />
                <span>轨道列表</span>
              </button>
            </div>
            <button
              ref={closeButtonRef}
              className="icon-button"
              type="button"
              title="关闭完整聊天树"
              aria-label="关闭完整聊天树"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="ftv-toolbar">
          <label className="ftv-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={state.searchQuery}
              placeholder="搜索说话者、正文、思考过程或状态"
              aria-label="搜索完整聊天树"
              onChange={(event) =>
                dispatch({ type: "setSearchQuery", query: event.target.value })
              }
            />
            {state.searchQuery && (
              <button
                type="button"
                className="ftv-search-clear"
                aria-label="清除搜索"
                title="清除搜索"
                onClick={() => dispatch({ type: "setSearchQuery", query: "" })}
              >
                <X size={14} />
              </button>
            )}
          </label>

          <div className="ftv-toolbar-actions" aria-label="完整聊天树显示控制">
            <button
              className={`secondary-button${state.compressChains ? " ftv-toggle-active" : ""}`}
              type="button"
              aria-pressed={state.compressChains}
              disabled={!tree.messages.length}
              title={
                state.compressChains
                  ? "当前已合并连续单线对话；点击展开所有单线节点"
                  : "点击自动合并连续无分叉的单线对话"
              }
              onClick={() => dispatch({ type: "toggleCompressChains" })}
            >
              <ChevronsDownUp size={15} />
              折叠单线
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!activeLeafId}
              onClick={locateCurrentNode}
            >
              <LocateFixed size={15} />
              定位当前
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!tree.messages.length}
              onClick={() =>
                dispatch({
                  type: "replaceExpandedSubtrees",
                  ids: allExpandableNodeIds(model)
                })
              }
            >
              <ChevronsDown size={15} />
              展开全部
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={!tree.messages.length}
              onClick={() =>
                dispatch({ type: "replaceExpandedSubtrees", ids: new Set() })
              }
            >
              <ChevronsUp size={15} />
              折叠全部
            </button>
          </div>

          <p className="ftv-result-count" role="status" aria-live="polite">
            {state.searchQuery.trim()
              ? `${displayForest.searchMatchCount} 个匹配 · 路径共 ${displayForest.totalVisibleMessages} 个节点`
              : `可见 ${displayForest.totalVisibleMessages} 个节点${displayForest.compressedMessageCount ? ` · 已合并 ${displayForest.compressedChainCount} 段共 ${displayForest.compressedMessageCount} 条连续对话` : ""}${hiddenSubtreeNodeCount ? ` · 子树折叠隐藏 ${hiddenSubtreeNodeCount} 个` : ""}`}
          </p>
        </div>

        {model.warnings.length > 0 && (
          <div className="ftv-warning" role="alert">
            <AlertTriangle size={16} />
            <div>
              {model.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        )}
        {state.selectionError && (
          <div className="forest-tree-error ftv-error" role="alert">
            {state.selectionError}
          </div>
        )}

        <div className="ftv-body">
          <div className="ftv-main-area">
            {displayForest.roots.length === 0 ? (
              <div className="ftv-empty">
                {model.roots.length ? <Search size={28} /> : <GitBranch size={28} />}
                <p>
                  {model.roots.length
                    ? "没有匹配的聊天节点。"
                    : "此会话还没有消息节点。"}
                </p>
                {state.searchQuery && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => dispatch({ type: "setSearchQuery", query: "" })}
                  >
                    清除搜索
                  </button>
                )}
              </div>
            ) : viewMode === "canvas" && canvasLayout ? (
              <div
                ref={canvasViewportRef}
                className={`ftv-canvas-viewport${isPanning ? " panning" : ""}`}
                aria-label="纵向拓扑画布"
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                onPointerUp={finishCanvasPan}
                onPointerCancel={finishCanvasPan}
              >
                <div
                  className={`ftv-canvas-stage${smoothStage ? " smooth" : ""}`}
                  style={{
                    width: `${canvasLayout.width}px`,
                    height: `${canvasLayout.height}px`,
                    transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.zoom})`
                  }}
                >
                  <svg
                    className="ftv-canvas-edges"
                    width={canvasLayout.width}
                    height={canvasLayout.height}
                    aria-hidden="true"
                  >
                    {canvasLayout.edges.map((edge) => (
                      <g key={edge.id}>
                        {edge.isActivePath && (
                          <path d={edge.path} className="ftv-edge-glow" />
                        )}
                        <path
                          d={edge.path}
                          className={
                            edge.isActivePath
                              ? "ftv-edge-active"
                              : edge.isSearchPath && state.searchQuery.trim()
                                ? "ftv-edge-search"
                                : "ftv-edge-side"
                          }
                        />
                      </g>
                    ))}
                  </svg>
                  {canvasLayout.nodes.map(renderCanvasNode)}
                </div>

                <div className="ftv-zoom-dock" role="group" aria-label="画布缩放控制">
                  <button
                    type="button"
                    className="ftv-zoom-btn"
                    title="缩小画布"
                    aria-label="缩小画布"
                    disabled={viewport.zoom <= CANVAS_MIN_ZOOM}
                    onClick={() => zoomByStep(-CANVAS_ZOOM_STEP)}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    className="ftv-zoom-btn"
                    title="重置为 100% 缩放"
                    aria-label="重置为 100% 缩放"
                    onClick={resetZoomTo100}
                  >
                    {Math.round(viewport.zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    className="ftv-zoom-btn"
                    title="放大画布"
                    aria-label="放大画布"
                    disabled={viewport.zoom >= CANVAS_MAX_ZOOM}
                    onClick={() => zoomByStep(CANVAS_ZOOM_STEP)}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    type="button"
                    className="ftv-zoom-btn"
                    title="适应画布"
                    aria-label="适应画布"
                    onClick={fitCanvas}
                  >
                    <Maximize2 size={14} />
                    <span>适应画布</span>
                  </button>
                </div>
              </div>
            ) : (
              metroLayout && (
                <div ref={metroScrollRef} className="ftv-metro-scroll">
                  <ul
                    className="ftv-metro-list"
                    role="tree"
                    aria-label="分支轨道列表"
                    onKeyDown={handleMetroKeyDown}
                  >
                    {metroLayout.rows.map((row) => renderMetroRow(row, gutterWidth))}
                  </ul>
                </div>
              )
            )}
          </div>

          {!isMobile && (
            <aside
              className="ftv-preview-panel"
              id={previewId}
              aria-label="分支完整预览"
            >
              {shownMessage ? (
                renderPreviewContent(
                  shownMessage,
                  state.pinnedId === shownMessage.id,
                  false
                )
              ) : (
                <p className="muted">未选择消息</p>
              )}
            </aside>
          )}

          {isMobile && shownMessage && (
            <>
              <button
                type="button"
                className="ftv-sheet-scrim"
                aria-label="关闭节点预览抽屉"
                onClick={() => dispatch({ type: "pinNode", id: null })}
              />
              <aside
                className="ftv-bottom-sheet"
                id={previewId}
                aria-label="分支完整预览"
              >
                <div className="ftv-sheet-grabber" aria-hidden="true" />
                {renderPreviewContent(shownMessage, true, true)}
              </aside>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export function ForestTreeView({
  tree,
  onClose,
  onSelectMessage,
  onContinueFrom,
  canContinue
}: Props) {
  const macroContext = useMessageMacroContext();
  const isMobile = useMediaQuery("(max-width: 920px)");
  const canHover = useMediaQuery("(hover: hover) and (pointer: fine)");
  const model = useMemo(() => buildForest(tree.messages), [tree.messages]);
  const [state, dispatch] = useReducer(
    forestTreeReducer,
    model,
    createInitialForestTreeState
  );

  const activePathKey = tree.active_path_ids.join("\u0000");
  const structureKey = tree.messages
    .map((message) => `${message.id}:${message.parent_id || ""}`)
    .join("\u0000");
  const knownIdsRef = useRef<Set<string>>(
    new Set(tree.messages.map((message) => message.id))
  );

  useEffect(() => {
    const newlyExpandable: string[] = [];
    for (const id of activePathExpandedNodeIds(model, tree.active_path_ids)) {
      newlyExpandable.push(id);
    }
    for (const message of tree.messages) {
      if (!knownIdsRef.current.has(message.id) && message.parent_id) {
        newlyExpandable.push(message.parent_id);
      }
      knownIdsRef.current.add(message.id);
    }
    if (newlyExpandable.length > 0) {
      dispatch({ type: "expandSubtrees", ids: newlyExpandable });
    }
    // Keys deliberately exclude streamed text so manual collapse is not reset on every token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePathKey, structureKey]);

  const dialog = (
    <ForestTreeDialog
      tree={tree}
      model={model}
      state={state}
      dispatch={dispatch}
      isMobile={isMobile}
      canHover={canHover}
      macroContext={macroContext}
      onClose={onClose}
      onSelectMessage={onSelectMessage}
      onContinueFrom={onContinueFrom}
      canContinue={canContinue}
    />
  );

  if (typeof document === "undefined" || !document.body) {
    return dialog;
  }
  return createPortal(dialog, document.body);
}
