import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Eye, GitFork, Globe2, RefreshCcw, Save, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { api, RegexRule, SessionTree, WorldBook } from "../lib/api";
import { markSettingsSaved, reconcileSettingsDrafts, resetSettingsDraft, settingsConflict, settingsDirty, settingsFromTree, updateSettingsDraft, type SessionSettingsDrafts } from "../features/chat/sessionSettingsDraft";
import { validateRegex } from "../lib/regex";
import { nearbyBranchGroups } from "../features/chat/nearbyBranches";
import "../styles/inspector.css";
import { CollapsibleSection } from "./CollapsibleSection";
import { GlobalPromptPanel } from "./GlobalPromptPanel";
import { ContextPreviewPanel } from "./ContextPreviewPanel";
import { SessionRegexSection } from "./SessionRegexSection";

export type InspectorTab = "all" | "branches" | "session" | "prompt";

type Props = {
  tree?: SessionTree;
  selectedSessionId: string | null;
  activeProfileId: string;
  worldbooks: WorldBook[];
  onSessionUpdated?: (sessionId: string) => Promise<void>;
  onOpenTree?: () => void;
  onSelectMessage: (messageId: string) => Promise<void>;
  onCloseMobile?: () => void;
  onError?: (message: string) => void;
  initialTab?: InspectorTab;
};

type SaveFeedback = { status: "saving" | "saved" | "error"; error?: string };
type BranchFeedback = { selecting: boolean; error?: string };

export function WorkspaceInspector({
  tree,
  selectedSessionId,
  activeProfileId,
  worldbooks,
  onSessionUpdated,
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
  const [settingsDrafts, setSettingsDrafts] = useState<SessionSettingsDrafts>({});
  const queryClient = useQueryClient();
  const [saveFeedbackBySession, setSaveFeedbackBySession] = useState<Record<string, SaveFeedback>>({});
  const [branchFeedbackBySession, setBranchFeedbackBySession] = useState<Record<string, BranchFeedback>>({});
  const savingSessions = useRef(new Set<string>());
  const selectingSessions = useRef(new Set<string>());
  const currentTree = tree?.session.id === selectedSessionId ? tree : undefined;
  const currentDraft = selectedSessionId ? settingsDrafts[selectedSessionId] : undefined;
  const remoteSettings = currentTree ? settingsFromTree(currentTree) : undefined;
  const regexRules = currentDraft?.value.regexRules || remoteSettings?.regexRules || [];
  const worldbookIds = currentDraft?.value.worldbookIds || remoteSettings?.worldbookIds || [];
  const hasSettingsConflict = currentDraft ? settingsConflict(currentDraft) : false;
  const hasSettingsChanges = currentDraft ? settingsDirty(currentDraft) : false;
  const saveFeedback = selectedSessionId ? saveFeedbackBySession[selectedSessionId] : undefined;
  const savingSession = saveFeedback?.status === "saving";
  const branchFeedback = selectedSessionId ? branchFeedbackBySession[selectedSessionId] : undefined;
  const allNearbyGroups = useMemo(() => nearbyBranchGroups(currentTree), [currentTree]);
  const nearbyGroups = allNearbyGroups.slice(0, 6);

  const previewQuery = useQuery({
    queryKey: ["context-preview", selectedSessionId, activeProfileId, currentTree?.active_path_ids.join(":")],
    queryFn: () => api.contextPreview(selectedSessionId!, activeProfileId),
    enabled: Boolean(selectedSessionId)
  });

  useEffect(() => {
    if (!currentTree) return;
    setSettingsDrafts((current) => reconcileSettingsDrafts(current, currentTree));
  }, [currentTree?.session]);

  function setRegexRules(update: SetStateAction<RegexRule[]>) {
    if (!currentTree) return;
    setSettingsDrafts((current) => updateSettingsDraft(current, currentTree, (value) => ({
      ...value,
      regexRules: typeof update === "function" ? update(value.regexRules) : update
    })));
  }

  function setWorldbookIds(update: SetStateAction<string[]>) {
    if (!currentTree) return;
    setSettingsDrafts((current) => updateSettingsDraft(current, currentTree, (value) => ({
      ...value,
      worldbookIds: typeof update === "function" ? update(value.worldbookIds) : update
    })));
  }

  const invalidRegexCount = useMemo(() => regexRules.filter((rule) => validateRegex(rule)).length, [regexRules]);

  async function saveSessionConfiguration() {
    if (!currentTree || !selectedSessionId || !currentDraft || !hasSettingsChanges || invalidRegexCount || hasSettingsConflict || savingSessions.current.has(selectedSessionId)) return;
    const sessionId = selectedSessionId;
    const sessionName = currentTree.session.title || sessionId;
    const submitted = currentDraft.value;
    savingSessions.current.add(sessionId);
    setSaveFeedbackBySession((current) => ({ ...current, [sessionId]: { status: "saving" } }));
    try {
      const sessionPreset = { ...currentTree.session.preset };
      delete sessionPreset.prompt_slots;
      const saved = await api.updateSession(sessionId, {
        worldbook_id: submitted.worldbookIds[0] || null,
        preset: {
          ...sessionPreset,
          worldbook_ids: submitted.worldbookIds,
          regex_rules: submitted.regexRules
        }
      });
      const savedSettings = settingsFromTree({ ...currentTree, session: saved });
      setSettingsDrafts((current) => markSettingsSaved(current, sessionId, submitted, savedSettings));
      try {
        await onSessionUpdated?.(sessionId);
        await queryClient.invalidateQueries({ queryKey: ["context-preview", sessionId] }, { throwOnError: true });
        setSaveFeedbackBySession((current) => ({ ...current, [sessionId]: { status: "saved" } }));
      } catch (cause) {
        const message = `会话“${sessionName}”的设置已保存，但刷新会话或上下文失败：${cause instanceof Error ? cause.message : String(cause)}`;
        setSaveFeedbackBySession((current) => ({ ...current, [sessionId]: { status: "saved", error: message } }));
        onError?.(message);
      }
    } catch (cause) {
      const message = `会话“${sessionName}”的设置保存失败：${cause instanceof Error ? cause.message : String(cause)}`;
      setSaveFeedbackBySession((current) => ({ ...current, [sessionId]: { status: "error", error: message } }));
      onError?.(message);
    } finally {
      savingSessions.current.delete(sessionId);
    }
  }

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
  const showSessionSettings = activeTab === "all" || activeTab === "session";
  const showPreview = activeTab === "all" || activeTab === "prompt" || activeTab === "branches";

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
          className={activeTab === "session" ? "pane-tab active" : "pane-tab"}
          aria-pressed={activeTab === "session"}
          onClick={() => selectTab("session")}
        >
          <BookOpen size={14} />
          <span>设置</span>
          {hasSettingsChanges && <small className="pane-tab-badge unsaved-dot" title="有未保存修改">•</small>}
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
          title="附近分叉"
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
                    title={message.content || "空消息"}
                  >
                    <span>{message.role === "assistant" ? "A" : message.role === "user" ? "U" : "S"}</span>
                    <p>{message.content || "空消息"}</p>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!currentTree && <p className="muted">未选择会话</p>}
          {currentTree && !nearbyGroups.length && <p className="muted">当前路径暂无分叉。</p>}
          {allNearbyGroups.length > nearbyGroups.length && <p className="section-help">已显示最近的 {nearbyGroups.length} 处分叉；较早的分叉可在完整树中查看。</p>}
          {branchFeedback?.selecting && <p className="save-feedback" role="status">正在切换分支…</p>}
          {branchFeedback?.error && <p className="field-error" role="alert">{branchFeedback.error}</p>}
          {onOpenTree && <button type="button" className="secondary-button full-button" disabled={!currentTree} onClick={onOpenTree}><GitFork size={15} />打开完整树</button>}
        </CollapsibleSection>
      )}

      {promptVisited && (
        <div hidden={!showPrompt}>
          <GlobalPromptPanel onError={onError} />
        </div>
      )}

      {showSessionSettings && (
        <>
          <SessionRegexSection
            selectedSessionId={selectedSessionId}
            regexRules={regexRules}
            setRegexRules={setRegexRules}
            defaultExpanded={activeTab === "session"}
          />

          <CollapsibleSection
            contentId="inspector-worldbooks-content"
            title="当前会话的世界书"
            icon={<GitFork size={16} />}
            storageKey="yggdrasil-tavern.inspector.worldbooks.expanded"
            className="inspector-section"
            defaultExpanded={activeTab === "session"}
            headerMeta={worldbookIds.length > 0 ? <span className="quiet-badge">已绑 {worldbookIds.length}</span> : undefined}
          >
            <div className="check-list">
              {worldbooks.map((book) => <label key={book.id}><input type="checkbox" checked={worldbookIds.includes(book.id)} onChange={() => setWorldbookIds((current) => current.includes(book.id) ? current.filter((item) => item !== book.id) : [...current, book.id])} />{book.name}</label>)}
              {!worldbooks.length && <p className="muted">尚无世界书。</p>}
            </div>
          </CollapsibleSection>

          {hasSettingsConflict && selectedSessionId && (
            <div className="field-error" role="alert">
              服务器上的当前会话设置已更新；本地未保存编辑仍保留。请重新加载服务器配置后再编辑。
              <button className="secondary-button" type="button" onClick={() => setSettingsDrafts((current) => resetSettingsDraft(current, selectedSessionId))}>重新加载服务器配置</button>
            </div>
          )}
          <div className="inspector-save-area">
            <button
              type="button"
              className={`${hasSettingsChanges ? "primary-button" : "secondary-button"} inspector-save`}
              disabled={!currentTree || !hasSettingsChanges || savingSession || invalidRegexCount > 0 || hasSettingsConflict}
              onClick={() => void saveSessionConfiguration()}
            ><Save size={16} />{savingSession ? "保存中…" : "保存会话设置"}</button>
            {(savingSession || hasSettingsChanges || saveFeedback?.status === "saved") && <p className="save-feedback" role="status" aria-live="polite">
              {savingSession ? "保存中…" : hasSettingsChanges ? "未保存" : "已保存"}
            </p>}
            {saveFeedback?.error && <p className="field-error" role="alert">{saveFeedback.error}</p>}
          </div>
        </>
      )}

      {showPreview && <ContextPreviewPanel selectedSessionId={selectedSessionId} previewQuery={previewQuery} />}
    </aside>
  );
}
