import { useQuery } from "@tanstack/react-query";
import { GitFork, Globe2, Network, RefreshCcw, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api, SessionTree, WorldBook } from "../lib/api";
import { markdownPreviewText } from "../lib/markdownPreview";
import { nearbyBranchGroups } from "../features/chat/nearbyBranches";
import "../styles/inspector.css";
import { CollapsibleSection } from "./CollapsibleSection";
import { GlobalPromptPanel } from "./GlobalPromptPanel";
import { GlobalWorldbookRegexPanel } from "./GlobalWorldbookRegexPanel";
import { ContextPreviewPanel } from "./ContextPreviewPanel";

export type InspectorTab = "all" | "branches" | "prompt";

type Props = {
  tree?: SessionTree;
  selectedSessionId: string | null;
  activeProfileId: string;
  worldbooks: WorldBook[];
  onOpenTree?: () => void;
  onSelectMessage: (messageId: string) => Promise<void>;
  onCloseMobile?: () => void;
  onError?: (message: string) => void;
  initialTab?: InspectorTab;
};

type BranchFeedback = { selecting: boolean; error?: string };

export function WorkspaceInspector({
  tree,
  selectedSessionId,
  activeProfileId,
  worldbooks,
  onOpenTree,
  onSelectMessage,
  onCloseMobile,
  onError,
  initialTab = "all"
}: Props) {
  const [activeTab, setActiveTab] = useState<InspectorTab>(initialTab);
  const [promptVisited, setPromptVisited] = useState(initialTab === "all" || initialTab === "prompt");

  function selectTab(tab: InspectorTab) {
    if (tab === "all" || tab === "prompt") setPromptVisited(true);
    setActiveTab(tab);
  }
  const [branchFeedbackBySession, setBranchFeedbackBySession] = useState<Record<string, BranchFeedback>>({});
  const selectingSessions = useRef(new Set<string>());
  const currentTree = tree?.session.id === selectedSessionId ? tree : undefined;
  const branchFeedback = selectedSessionId ? branchFeedbackBySession[selectedSessionId] : undefined;
  const allNearbyGroups = useMemo(() => nearbyBranchGroups(currentTree), [currentTree]);
  const nearbyGroups = allNearbyGroups.slice(0, 6);

  const previewQuery = useQuery({
    queryKey: ["context-preview", selectedSessionId, activeProfileId, currentTree?.active_path_ids.join(":")],
    queryFn: () => api.contextPreview(selectedSessionId!, activeProfileId),
    enabled: Boolean(selectedSessionId)
  });

  async function selectBranch(messageId: string) {
    if (!selectedSessionId || !currentTree || selectingSessions.current.has(selectedSessionId)) return;
    const sessionId = selectedSessionId;
    const sessionName = currentTree.session.title || sessionId;
    selectingSessions.current.add(sessionId);
    setBranchFeedbackBySession((current) => ({ ...current, [sessionId]: { selecting: true } }));
    try {
      await onSelectMessage(messageId);
      setBranchFeedbackBySession((current) => ({ ...current, [sessionId]: { selecting: false } }));
    } catch (cause) {
      const message = `会话“${sessionName}”切换分支失败：${cause instanceof Error ? cause.message : String(cause)}`;
      setBranchFeedbackBySession((current) => ({ ...current, [sessionId]: { selecting: false, error: message } }));
      onError?.(message);
    } finally {
      selectingSessions.current.delete(sessionId);
    }
  }

  const showBranches = activeTab === "all" || activeTab === "branches";
  const showPrompt = activeTab === "all" || activeTab === "prompt";

  return (
    <aside className="right-pane">
      <header className="pane-header">
        <div>
          <p className="eyebrow">当前会话</p>
          <h2>分支与设置</h2>
        </div>
        <div className="pane-header-actions">
          <button className="icon-button" type="button" title="刷新当前会话上下文" aria-label="刷新当前会话上下文" disabled={!selectedSessionId} onClick={() => void previewQuery.refetch()}>
            <RefreshCcw size={17} />
          </button>
          {onCloseMobile && (
            <button className="icon-button inspector-close" type="button" title="关闭分支与设置" aria-label="关闭分支与设置" onClick={onCloseMobile}>
              <X size={17} />
            </button>
          )}
        </div>
      </header>

      <nav className="pane-tabs inspector-tabs" aria-label="检查器分区">
        <button
          type="button"
          className={activeTab === "all" ? "pane-tab active" : "pane-tab"}
          aria-pressed={activeTab === "all"}
          onClick={() => selectTab("all")}
        >
          <span>全部</span>
        </button>
        <button
          type="button"
          className={activeTab === "branches" ? "pane-tab active" : "pane-tab"}
          aria-pressed={activeTab === "branches"}
          onClick={() => selectTab("branches")}
        >
          <GitFork size={14} />
          <span>分支</span>
          {allNearbyGroups.length > 0 && <small className="pane-tab-badge">{allNearbyGroups.length}</small>}
        </button>
        <button
          type="button"
          className={activeTab === "prompt" ? "pane-tab active" : "pane-tab"}
          aria-pressed={activeTab === "prompt"}
          onClick={() => selectTab("prompt")}
        >
          <Globe2 size={14} />
          <span>Prompt</span>
        </button>
      </nav>

      {showBranches && (
        <CollapsibleSection
          contentId="inspector-nearby-branches-content"
          title="附近分支"
          icon={<GitFork size={16} />}
          storageKey="yggdrasil-tavern.inspector.nearby-branches.expanded"
          className="inspector-section nearby-branches-section"
          defaultExpanded
        >
          {nearbyGroups.map((group) => (
            <section className="nearby-branch-group" key={group.parentId || "root"}>
              <h3>{group.parentId === null ? "开场分支" : `第 ${group.messagePosition} 条消息的分支`}</h3>
              <div className="branch-map">
                {group.branches.map((message) => (
                  <button
                    type="button"
                    key={message.id}
                    className={group.activeMessageId === message.id ? "branch-node active" : "branch-node"}
                    aria-current={group.activeMessageId === message.id ? "true" : undefined}
                    disabled={branchFeedback?.selecting}
                    onClick={() => void selectBranch(message.id)}
                    title={markdownPreviewText(message.content) || "空消息"}
                  >
                    <span>{message.role === "assistant" ? "A" : message.role === "user" ? "U" : "S"}</span>
                    <p>{markdownPreviewText(message.content) || "空消息"}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!currentTree && <p className="muted">未选择会话</p>}
          {currentTree && !nearbyGroups.length && <p className="muted">当前路径暂无分支。</p>}
          {allNearbyGroups.length > nearbyGroups.length && <p className="section-help">已显示最近 {nearbyGroups.length} 处分支；更早的分支可在完整聊天树中查看。</p>}
          {branchFeedback?.selecting && <p className="save-feedback" role="status">正在切换分支…</p>}
          {branchFeedback?.error && <p className="field-error" role="alert">{branchFeedback.error}</p>}
          {onOpenTree && <button type="button" className="secondary-button full-button" disabled={!currentTree} onClick={onOpenTree}><Network size={15} />打开完整聊天树</button>}
        </CollapsibleSection>
      )}

      {/* Stays mounted after the first visit so unsaved global drafts survive tab switches. */}
      {promptVisited && (
        <div hidden={!showPrompt}>
          <GlobalPromptPanel onError={onError} />
          <GlobalWorldbookRegexPanel worldbooks={worldbooks} onError={onError} />
        </div>
      )}

      <ContextPreviewPanel selectedSessionId={selectedSessionId} previewQuery={previewQuery} worldbooks={worldbooks} />
    </aside>
  );
}
