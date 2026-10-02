import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  GitBranch,
  LocateFixed,
  Search,
  X
} from "lucide-react";
import { Message, SessionTree } from "../lib/api";
import { sortMessages } from "../lib/tree";

type Props = {
  tree: SessionTree;
  onClose: () => void;
  onSelectMessage: (messageId: string) => Promise<void>;
};

export type ForestNode = {
  message: Message;
  children: ForestNode[];
  descendantCount: number;
};

export type ForestModel = {
  roots: ForestNode[];
  warnings: string[];
};

export type VisibleForestRow = {
  node: ForestNode;
  depth: number;
  expanded: boolean;
  hiddenDescendantCount: number;
  isSearchMatch: boolean;
  siblingIndex: number;
  siblingCount: number;
};

function roleLabel(role: Message["role"]): string {
  if (role === "assistant") return "角色";
  if (role === "user") return "用户";
  return "系统";
}

function messageSummary(message: Message): string {
  const compact = message.content.replace(/\s+/g, " ").trim();
  if (!compact) return "（空消息）";
  return compact.length > 96 ? `${compact.slice(0, 96)}…` : compact;
}

function searchableMessageText(message: Message): string {
  return [message.id, message.speaker, roleLabel(message.role), message.role, message.status, message.content, message.thinking_content]
    .join("\n")
    .toLocaleLowerCase();
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function walkForest(nodes: ForestNode[], visit: (node: ForestNode) => void) {
  for (const node of nodes) {
    visit(node);
    walkForest(node.children, visit);
  }
}

export function buildForest(messages: Message[]): ForestModel {
  const ids = new Set(messages.map((message) => message.id));
  const childrenByParent = new Map<string, Message[]>();
  const warnings = new Set<string>();
  let missingParentCount = 0;

  for (const message of messages) {
    if (!message.parent_id || !ids.has(message.parent_id)) {
      if (message.parent_id) missingParentCount += 1;
      continue;
    }
    const children = childrenByParent.get(message.parent_id) || [];
    children.push(message);
    childrenByParent.set(message.parent_id, children);
  }

  if (missingParentCount > 0) warnings.add(`${missingParentCount} 个节点引用了不存在的父节点，已将它们作为根节点显示。`);
  const visited = new Set<string>();

  function visit(message: Message, ancestors: Set<string>): ForestNode {
    visited.add(message.id);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(message.id);
    const children: ForestNode[] = [];

    for (const child of sortMessages(childrenByParent.get(message.id) || [])) {
      if (nextAncestors.has(child.id)) {
        warnings.add("检测到聊天树中的循环引用；循环边已断开，其余节点仍会显示。");
        continue;
      }
      if (visited.has(child.id)) {
        warnings.add("检测到重复连接的聊天节点；重复边已忽略。");
        continue;
      }
      children.push(visit(child, nextAncestors));
    }

    const descendantCount = children.reduce((total, child) => total + child.descendantCount + 1, 0);
    return { message, children, descendantCount };
  }

  const rootMessages = sortMessages(messages.filter((message) => !message.parent_id || !ids.has(message.parent_id)));
  const roots = rootMessages.map((message) => visit(message, new Set<string>()));

  for (const message of sortMessages(messages)) {
    if (visited.has(message.id)) continue;
    warnings.add("检测到未连接到根节点的消息，已将它们作为独立树显示。");
    roots.push(visit(message, new Set<string>()));
  }

  return { roots, warnings: [...warnings] };
}

export function allExpandableNodeIds(model: ForestModel): Set<string> {
  const ids = new Set<string>();
  walkForest(model.roots, (node) => {
    if (node.children.length > 0) ids.add(node.message.id);
  });
  return ids;
}

export function activePathExpandedNodeIds(model: ForestModel, activePathIds: string[]): Set<string> {
  const activePath = new Set(activePathIds);
  const ids = new Set<string>();
  walkForest(model.roots, (node) => {
    if (node.children.length > 0 && activePath.has(node.message.id)) ids.add(node.message.id);
  });
  return ids;
}

export function visibleForestRows(model: ForestModel, expandedIds: ReadonlySet<string>, searchQuery = ""): VisibleForestRow[] {
  const query = searchQuery.trim().toLocaleLowerCase();
  const subtreeMatches = new Map<string, boolean>();

  function isMatch(node: ForestNode): boolean {
    return Boolean(query) && searchableMessageText(node.message).includes(query);
  }

  function hasMatch(node: ForestNode): boolean {
    const cached = subtreeMatches.get(node.message.id);
    if (cached !== undefined) return cached;
    const matches = isMatch(node) || node.children.some(hasMatch);
    subtreeMatches.set(node.message.id, matches);
    return matches;
  }

  const rows: VisibleForestRow[] = [];
  function visit(nodes: ForestNode[], depth: number) {
    const visibleSiblings = query ? nodes.filter(hasMatch) : nodes;
    visibleSiblings.forEach((node, index) => {
      const matchingChildren = query ? node.children.filter(hasMatch) : node.children;
      const expanded = node.children.length > 0 && (query ? matchingChildren.length > 0 : expandedIds.has(node.message.id));
      rows.push({
        node,
        depth,
        expanded,
        hiddenDescendantCount: !query && !expanded ? node.descendantCount : 0,
        isSearchMatch: isMatch(node),
        siblingIndex: index + 1,
        siblingCount: visibleSiblings.length
      });
      if (expanded) visit(matchingChildren, depth + 1);
    });
  }

  visit(model.roots, 0);
  return rows;
}

export function shouldJumpToNode(pinnedId: string | null, messageId: string): boolean {
  return pinnedId === messageId;
}

function scrollBehavior(): ScrollBehavior {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "auto";
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

export function ForestTreeView({ tree, onClose, onSelectMessage }: Props) {
  const titleId = useId();
  const previewId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const model = useMemo(() => buildForest(tree.messages), [tree.messages]);
  const activePathKey = tree.active_path_ids.join("\u0000");
  const structureKey = tree.messages.map((message) => `${message.id}:${message.parent_id || ""}`).join("\u0000");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => activePathExpandedNodeIds(model, tree.active_path_ids));
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const messagesById = useMemo(() => new Map(tree.messages.map((message) => [message.id, message])), [tree.messages]);
  const activePath = useMemo(() => new Set(tree.active_path_ids), [tree.active_path_ids]);
  const activeLeafId = useMemo(() => {
    for (let index = tree.active_path_ids.length - 1; index >= 0; index -= 1) {
      const messageId = tree.active_path_ids[index];
      if (messagesById.has(messageId)) return messageId;
    }
    return null;
  }, [messagesById, tree.active_path_ids]);
  const firstRootId = model.roots[0]?.message.id || null;
  const shownId = hoveredId || focusedId || pinnedId || activeLeafId || firstRootId;
  const shownMessage = shownId ? messagesById.get(shownId) : undefined;
  const visibleRows = useMemo(() => visibleForestRows(model, expandedIds, searchQuery), [expandedIds, model, searchQuery]);
  const searchMatchCount = visibleRows.filter((row) => row.isSearchMatch).length;
  const hiddenNodeCount = Math.max(0, tree.messages.length - visibleRows.length);

  useEffect(() => {
    const activeExpansion = activePathExpandedNodeIds(model, tree.active_path_ids);
    setExpandedIds((current) => {
      const next = new Set(current);
      let changed = false;
      for (const id of activeExpansion) {
        if (next.has(id)) continue;
        next.add(id);
        changed = true;
      }
      return changed ? next : current;
    });
    // The keys deliberately exclude streamed text, so manual collapse is not reset on every token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePathKey, structureKey]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.getElementById("root");
    const wasInert = background?.inert || false;
    if (background) background.inert = true;
    closeButtonRef.current?.focus();
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const dialog = closeButtonRef.current?.closest(".forest-tree-dialog");
        const controls = Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']") || [])
          .filter((item) => item.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      if (background) background.inert = wasInert;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  function scrollToNode(messageId: string, focus = false) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const element = nodeRefs.current.get(messageId);
      element?.scrollIntoView({ block: "center", inline: "nearest", behavior: scrollBehavior() });
      if (focus) element?.focus({ preventScroll: true });
    }));
  }

  function locateCurrentNode() {
    if (!activeLeafId) return;
    setSearchQuery("");
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const id of activePathExpandedNodeIds(model, tree.active_path_ids)) next.add(id);
      return next;
    });
    scrollToNode(activeLeafId, true);
  }

  function toggleNode(messageId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  async function activateNode(message: Message) {
    if (selectingId) return;
    setSelectionError(null);
    if (!shouldJumpToNode(pinnedId, message.id)) {
      setPinnedId(message.id);
      requestAnimationFrame(() => previewRef.current?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() }));
      return;
    }
    setSelectingId(message.id);
    try {
      await onSelectMessage(message.id);
      onClose();
    } catch (cause) {
      setSelectionError(`无法跳转到所选节点：${errorMessage(cause)}`);
      console.error("Forest Tree View 跳转失败", cause);
    } finally {
      setSelectingId(null);
    }
  }

  function renderRow(row: VisibleForestRow) {
    const { message, children } = row.node;
    const isActive = activePath.has(message.id);
    const isCurrent = activeLeafId === message.id;
    const isPinned = pinnedId === message.id;
    const className = [
      "forest-tree-node",
      isActive ? "active-path" : "",
      isCurrent ? "current-node" : "",
      isPinned ? "pinned-preview" : "",
      row.isSearchMatch ? "search-match" : "",
      selectingId === message.id ? "selecting" : ""
    ].filter(Boolean).join(" ");

    return (
      <li
        className={`forest-tree-item${row.depth === 0 ? " forest-tree-root-row" : ""}`}
        key={message.id}
        role="treeitem"
        aria-level={row.depth + 1}
        aria-posinset={row.siblingIndex}
        aria-setsize={row.siblingCount}
        aria-expanded={children.length > 0 ? row.expanded : undefined}
        style={{ "--forest-depth": row.depth } as CSSProperties}
      >
        <div className="forest-tree-node-line">
          {children.length > 0 ? (
            <button
              className="forest-tree-branch-toggle"
              type="button"
              disabled={Boolean(searchQuery.trim())}
              title={searchQuery.trim() ? "搜索时自动展开匹配路径" : row.expanded ? "折叠子树" : `展开子树（${row.hiddenDescendantCount} 个隐藏节点）`}
              aria-label={searchQuery.trim() ? "搜索时自动展开匹配路径" : row.expanded ? `折叠 ${message.speaker || roleLabel(message.role)} 的子树` : `展开 ${message.speaker || roleLabel(message.role)} 的子树，包含 ${row.hiddenDescendantCount} 个隐藏节点`}
              onClick={() => toggleNode(message.id)}
            >
              {row.expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
              {!row.expanded && row.hiddenDescendantCount > 0 && <span>+{row.hiddenDescendantCount}</span>}
            </button>
          ) : <span className="forest-tree-branch-spacer" aria-hidden="true" />}
          <button
            ref={(element) => {
              if (element) nodeRefs.current.set(message.id, element);
              else nodeRefs.current.delete(message.id);
            }}
            className={className}
            type="button"
            data-message-id={message.id}
            aria-current={isCurrent ? "true" : undefined}
            aria-pressed={isPinned}
            aria-controls={previewId}
            disabled={Boolean(selectingId)}
            onPointerEnter={(event) => event.pointerType === "mouse" && setHoveredId(message.id)}
            onPointerLeave={(event) => event.pointerType === "mouse" && setHoveredId((current) => current === message.id ? null : current)}
            onFocus={() => setFocusedId(message.id)}
            onBlur={() => setFocusedId((current) => current === message.id ? null : current)}
            onClick={() => void activateNode(message)}
          >
            <span className={`forest-tree-role role-${message.role}`}>{roleLabel(message.role)}</span>
            <span className="forest-tree-node-copy">
              <span className="forest-tree-node-speaker">{message.speaker || roleLabel(message.role)}</span>
              <span className="forest-tree-node-summary">{messageSummary(message)}</span>
            </span>
            <span className="forest-tree-node-tail">
              {isCurrent && <span className="forest-tree-current-badge">当前</span>}
              <span className={`forest-tree-status status-${message.status}`}>{message.status || "unknown"}</span>
            </span>
          </button>
        </div>
      </li>
    );
  }

  const dialog = (
    <div className="forest-tree-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="forest-tree-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="forest-tree-header">
          <div>
            <p className="eyebrow">Conversation Forest</p>
            <h2 id={titleId}>Tree View</h2>
            <p className="forest-tree-instructions">悬停或聚焦可临时预览；点击一次固定预览，再点同一节点即可跳转。</p>
            <p className="forest-tree-stats">{model.roots.length} 棵树 · {tree.messages.length} 个节点 · 当前路径 {tree.active_path_ids.length} 个节点</p>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" title="关闭 Tree View" aria-label="关闭 Tree View" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="forest-tree-toolbar">
          <label className="forest-tree-search">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={searchQuery} placeholder="搜索说话者、状态或 swipe 文本" aria-label="搜索聊天森林" onChange={(event) => setSearchQuery(event.target.value)} />
            {searchQuery && <button type="button" className="forest-tree-search-clear" aria-label="清除搜索" title="清除搜索" onClick={() => setSearchQuery("")}><X size={14} /></button>}
          </label>
          <div className="forest-tree-toolbar-actions" aria-label="Tree View 显示控制">
            <button className="secondary-button" type="button" disabled={!activeLeafId} onClick={locateCurrentNode}><LocateFixed size={15} />定位当前</button>
            <button className="secondary-button" type="button" disabled={!tree.messages.length} onClick={() => setExpandedIds(allExpandableNodeIds(model))}><ChevronsDown size={15} />展开全部</button>
            <button className="secondary-button" type="button" disabled={!tree.messages.length} onClick={() => setExpandedIds(new Set())}><ChevronsUp size={15} />折叠全部</button>
          </div>
          <p className="forest-tree-result-count" role="status" aria-live="polite">
            {searchQuery.trim() ? `${searchMatchCount} 个匹配 · 显示 ${visibleRows.length} 个节点（含路径）` : `显示 ${visibleRows.length} 个节点${hiddenNodeCount ? ` · 折叠隐藏 ${hiddenNodeCount} 个` : ""}`}
          </p>
        </div>

        {model.warnings.length > 0 && <div className="forest-tree-warning" role="alert"><AlertTriangle size={17} /><div>{model.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}
        {selectionError && <div className="forest-tree-error" role="alert">{selectionError}</div>}

        <div className="forest-tree-body">
          <div className="forest-tree-canvas" aria-label="完整聊天森林">
            {visibleRows.length > 0 ? (
              <ul className="forest-tree-roots" role="tree" aria-label="全部聊天节点">{visibleRows.map(renderRow)}</ul>
            ) : (
              <div className="forest-tree-empty">
                {model.roots.length ? <Search size={28} /> : <GitBranch size={28} />}
                <p>{model.roots.length ? "没有匹配的聊天节点。" : "此会话还没有消息节点。"}</p>
                {searchQuery && <button className="secondary-button" type="button" onClick={() => setSearchQuery("")}>清除搜索</button>}
              </div>
            )}
          </div>

          <aside ref={previewRef} className="forest-tree-preview" id={previewId} aria-label="Swipe 完整预览">
            {shownMessage ? (
              <>
                <header className="forest-tree-preview-header">
                  <div><p className="eyebrow">Swipe Preview</p><h3>{shownMessage.speaker || roleLabel(shownMessage.role)}</h3></div>
                  <div className="forest-tree-preview-badges">
                    <span>{roleLabel(shownMessage.role)}</span><span>{shownMessage.status || "unknown"}</span>
                    {activePath.has(shownMessage.id) && <span className="active-path">当前路径</span>}
                  </div>
                </header>
                <div className="forest-tree-preview-scroll">
                  <pre className="forest-tree-preview-content">{shownMessage.content || "（空消息）"}</pre>
                  {shownMessage.error && <div className="forest-tree-message-error" role="alert">节点错误：{shownMessage.error}</div>}
                </div>
                <footer className="forest-tree-preview-footer">
                  {pinnedId === shownMessage.id ? (
                    <><p>预览已固定。再次点击树中同一节点，或点击此按钮跳转到该分支。</p><button className="primary-button" type="button" disabled={Boolean(selectingId)} onClick={() => void activateNode(shownMessage)}><ArrowRight size={16} />{selectingId === shownMessage.id ? "正在跳转…" : "跳转到此节点"}</button></>
                  ) : <p>{pinnedId ? "这是临时预览；移开后会回到已固定节点。" : "点击树中的节点可固定这段完整预览。"}</p>}
                </footer>
              </>
            ) : <p className="muted">悬停、聚焦或点击节点以查看完整 swipe 文本。</p>}
          </aside>
        </div>
      </section>
    </div>
  );

  return createPortal(dialog, document.body);
}
