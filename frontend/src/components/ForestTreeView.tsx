import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowRight, GitBranch, X } from "lucide-react";
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
};

export type ForestModel = {
  roots: ForestNode[];
  warnings: string[];
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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

  if (missingParentCount > 0) {
    warnings.add(`${missingParentCount} 个节点引用了不存在的父节点，已将它们作为根节点显示。`);
  }

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

    return { message, children };
  }

  const rootMessages = sortMessages(messages.filter((message) => !message.parent_id || !ids.has(message.parent_id)));
  const roots = rootMessages.map((message) => visit(message, new Set<string>()));

  // A valid tree is fully reached from the roots. Any remainder is malformed
  // (usually a cycle), but showing it as another root keeps the Forest complete.
  for (const message of sortMessages(messages)) {
    if (visited.has(message.id)) continue;
    warnings.add("检测到未连接到根节点的消息，已将它们作为独立树显示。");
    roots.push(visit(message, new Set<string>()));
  }

  return { roots, warnings: [...warnings] };
}

export function ForestTreeView({ tree, onClose, onSelectMessage }: Props) {
  const titleId = useId();
  const previewId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  const model = useMemo(() => buildForest(tree.messages), [tree.messages]);
  const messagesById = useMemo(
    () => new Map(tree.messages.map((message) => [message.id, message])),
    [tree.messages]
  );
  const activePath = useMemo(() => new Set(tree.active_path_ids), [tree.active_path_ids]);
  const activeLeafId = tree.active_path_ids[tree.active_path_ids.length - 1] || null;
  const firstRootId = model.roots[0]?.message.id || null;
  const shownId = hoveredId || focusedId || pinnedId || activeLeafId || firstRootId;
  const shownMessage = shownId ? messagesById.get(shownId) : undefined;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  async function activateNode(message: Message) {
    if (selectingId) return;
    setSelectionError(null);

    if (pinnedId !== message.id) {
      setPinnedId(message.id);
      requestAnimationFrame(() => previewRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
      return;
    }

    setSelectingId(message.id);
    try {
      await onSelectMessage(message.id);
      onClose();
    } catch (cause) {
      const detail = errorMessage(cause);
      setSelectionError(`无法跳转到所选节点：${detail}`);
      console.error("Forest Tree View 跳转失败", cause);
    } finally {
      setSelectingId(null);
    }
  }

  function renderNode(node: ForestNode) {
    const { message, children } = node;
    const isActive = activePath.has(message.id);
    const isPinned = pinnedId === message.id;
    const className = [
      "forest-tree-node",
      isActive ? "active-path" : "",
      isPinned ? "pinned-preview" : "",
      selectingId === message.id ? "selecting" : ""
    ].filter(Boolean).join(" ");

    return (
      <li
        className="forest-tree-item"
        key={message.id}
        role="treeitem"
        aria-expanded={children.length ? true : undefined}
      >
        <button
          className={className}
          type="button"
          data-message-id={message.id}
          aria-current={isActive ? "step" : undefined}
          aria-pressed={isPinned}
          aria-describedby={previewId}
          disabled={Boolean(selectingId)}
          onMouseEnter={() => setHoveredId(message.id)}
          onMouseLeave={() => setHoveredId((current) => current === message.id ? null : current)}
          onFocus={() => setFocusedId(message.id)}
          onBlur={() => setFocusedId((current) => current === message.id ? null : current)}
          onClick={() => void activateNode(message)}
        >
          <span className={`forest-tree-role role-${message.role}`}>{roleLabel(message.role)}</span>
          <span className="forest-tree-node-copy">
            <span className="forest-tree-node-speaker">{message.speaker || roleLabel(message.role)}</span>
            <span className="forest-tree-node-summary">{messageSummary(message)}</span>
          </span>
          <span className={`forest-tree-status status-${message.status}`}>{message.status || "unknown"}</span>
        </button>
        {children.length > 0 && (
          <ul className="forest-tree-children" role="group">
            {children.map(renderNode)}
          </ul>
        )}
      </li>
    );
  }

  const dialog = (
    <div
      className="forest-tree-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="forest-tree-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="forest-tree-header">
          <div>
            <p className="eyebrow">Conversation Forest</p>
            <h2 id={titleId}>Tree View</h2>
            <p className="forest-tree-instructions">悬停或聚焦可临时预览；点击一次固定预览，再点同一节点即可跳转。</p>
            <p className="forest-tree-stats">{model.roots.length} 棵树 · {tree.messages.length} 个节点 · 当前路径 {tree.active_path_ids.length} 个节点</p>
          </div>
          <button ref={closeButtonRef} className="icon-button" type="button" title="关闭 Tree View" aria-label="关闭 Tree View" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {model.warnings.length > 0 && (
          <div className="forest-tree-warning" role="alert">
            <AlertTriangle size={17} />
            <div>{model.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>
          </div>
        )}

        {selectionError && <div className="forest-tree-error" role="alert">{selectionError}</div>}

        <div className="forest-tree-body">
          <div className="forest-tree-canvas" aria-label="完整聊天森林">
            {model.roots.length > 0 ? (
              <ul className="forest-tree-roots" role="tree" aria-label="全部聊天节点">
                {model.roots.map(renderNode)}
              </ul>
            ) : (
              <div className="forest-tree-empty"><GitBranch size={28} /><p>此会话还没有消息节点。</p></div>
            )}
          </div>

          <aside ref={previewRef} className="forest-tree-preview" id={previewId} aria-label="Swipe 完整预览">
            {shownMessage ? (
              <>
                <header className="forest-tree-preview-header">
                  <div>
                    <p className="eyebrow">Swipe Preview</p>
                    <h3>{shownMessage.speaker || roleLabel(shownMessage.role)}</h3>
                  </div>
                  <div className="forest-tree-preview-badges">
                    <span>{roleLabel(shownMessage.role)}</span>
                    <span>{shownMessage.status || "unknown"}</span>
                    {activePath.has(shownMessage.id) && <span className="active-path">当前路径</span>}
                  </div>
                </header>
                <pre className="forest-tree-preview-content">{shownMessage.content || "（空消息）"}</pre>
                {shownMessage.error && <div className="forest-tree-message-error" role="alert">节点错误：{shownMessage.error}</div>}
                <footer className="forest-tree-preview-footer">
                  {pinnedId === shownMessage.id ? (
                    <>
                      <p>预览已固定。再次点击左侧同一节点，或点击此按钮跳转到该分支。</p>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={Boolean(selectingId)}
                        onClick={() => void activateNode(shownMessage)}
                      >
                        <ArrowRight size={16} />
                        {selectingId === shownMessage.id ? "正在跳转…" : "跳转到此节点"}
                      </button>
                    </>
                  ) : (
                    <p>{pinnedId ? "这是临时预览；移开后会回到已固定节点。" : "点击树中的节点可固定这段完整预览。"}</p>
                  )}
                </footer>
              </>
            ) : (
              <p className="muted">悬停、聚焦或点击节点以查看完整 swipe 文本。</p>
            )}
          </aside>
        </div>
      </section>
    </div>
  );

  return createPortal(dialog, document.body);
}
