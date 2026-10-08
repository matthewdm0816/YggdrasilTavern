import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, GitFork, Plus, RefreshCcw, Save, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { api, RegexRule, RegexTarget, SessionTree, WorldBook } from "../lib/api";
import { markSettingsSaved, reconcileSettingsDrafts, resetSettingsDraft, settingsConflict, settingsDirty, settingsFromTree, updateSettingsDraft, type SessionSettingsDrafts } from "../features/chat/sessionSettingsDraft";
import { validateRegex } from "../lib/regex";
import { nearbyBranchGroups } from "../features/chat/nearbyBranches";
import "../styles/inspector.css";
import { CollapsibleSection } from "./CollapsibleSection";
import { GlobalPromptPanel } from "./GlobalPromptPanel";
import { ContextPreviewPanel } from "./ContextPreviewPanel";

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
};

type SaveFeedback = { status: "saving" | "saved" | "error"; error?: string };
type BranchFeedback = { selecting: boolean; error?: string };

const targets: Array<{ value: RegexTarget; label: string; help?: string }> = [
  { value: "display", label: "聊天显示" },
  { value: "user_input", label: "用户消息" },
  { value: "assistant_output", label: "角色回复" },
  { value: "outgoing_prompt", label: "发送给模型的 Prompt", help: "仅支持显式替换" }
];

const regexFlagOptions = [
  { flag: "g", label: "替换全部命中", help: "关闭时，每段文本只替换第一个命中。" },
  { flag: "i", label: "忽略大小写", help: "" },
  { flag: "m", label: "按行匹配开头与结尾", help: "让 ^ 和 $ 对每一行分别生效。" },
  { flag: "s", label: "点号可以跨行", help: "让 . 也能匹配换行符。" }
] as const;

function id(prefix: string): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random()}`;
}

export function WorkspaceInspector({ tree, selectedSessionId, activeProfileId, worldbooks, onSessionUpdated, onOpenTree, onSelectMessage, onCloseMobile, onError }: Props) {

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

  function patchRule(index: number, patch: Partial<RegexRule>) {
    setRegexRules((current) => current.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule));
  }

  function toggleTarget(index: number, target: RegexTarget) {
    const current = regexRules[index].targets;
    patchRule(index, { targets: current.includes(target) ? current.filter((item) => item !== target) : [...current, target] });
  }

  function toggleRegexFlag(index: number, flag: string) {
    const current = new Set(regexRules[index].flags.split("").filter((item) => "gims".includes(item)));
    if (current.has(flag)) current.delete(flag);
    else current.add(flag);
    patchRule(index, { flags: "gims".split("").filter((item) => current.has(item)).join("") });
  }

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

  return (
    <aside className="right-pane">
      <header className="pane-header">
        <div><p className="eyebrow">当前会话</p><h2>分支与设置</h2></div>
        <div className="pane-header-actions"><button className="icon-button" title="刷新当前会话上下文" aria-label="刷新当前会话上下文" disabled={!selectedSessionId} onClick={() => previewQuery.refetch()}><RefreshCcw size={17} /></button>{onCloseMobile && <button className="icon-button inspector-close" title="关闭分支与设置" aria-label="关闭分支与设置" onClick={onCloseMobile}><X size={17} /></button>}</div>
      </header>

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

      <GlobalPromptPanel onError={onError} />

      <CollapsibleSection
        contentId="inspector-regex-content"
        title="当前会话 Regex"
        icon={<Eye size={16} />}
        storageKey="yggdrasil-tavern.inspector.regex.expanded"
        className="inspector-section"
      >

        <div className="regex-rule-list">
          {regexRules.map((rule, index) => {
            const validation = validateRegex(rule);
            return (
              <details className={`regex-rule-card ${rule.enabled ? "enabled" : "disabled"}`} key={`${selectedSessionId}:${rule.id}`}>
                <summary><span>{rule.name || "未命名 Regex"}</span><small>{rule.enabled ? "已启用" : "已停用"}{validation ? " · 规则有误" : ""}</small></summary>
                <div className="regex-rule-fields">
                <header>
                  <label className="form-field"><span>规则名称</span><input value={rule.name} onChange={(event) => patchRule(index, { name: event.target.value })} /></label>
                  <button
                    className={`icon-button config-toggle ${rule.enabled ? "active" : ""}`}
                    aria-pressed={rule.enabled}
                    aria-label={rule.enabled ? `停用 ${rule.name || "Regex"}` : `启用 ${rule.name || "Regex"}`}
                    title={rule.enabled ? "已启用；点击停用" : "已停用；点击启用"}
                    onClick={() => patchRule(index, { enabled: !rule.enabled })}
                  >{rule.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button>
                </header>
                <label className="form-field"><span>查找规则（正则表达式）</span><input value={rule.pattern} onChange={(event) => patchRule(index, { pattern: event.target.value })} /></label>
                {validation && <p className="field-error" role="alert">{validation}</p>}
                <label className="form-field"><span>替换内容</span><input value={rule.replacement} onChange={(event) => patchRule(index, { replacement: event.target.value })} /><small>可用 $1、$2 引用分组；遮罩模式下作为揭示文本。</small></label>
                <fieldset className="regex-flags">
                  <legend>匹配选项</legend>
                  {regexFlagOptions.map((option) => (
                    <label key={option.flag} title={option.help}>
                      <input type="checkbox" checked={rule.flags.includes(option.flag)} onChange={() => toggleRegexFlag(index, option.flag)} />
                      <span><strong>{option.label}</strong></span>
                    </label>
                  ))}
                </fieldset>
                <label className="form-field"><span>处理方式</span><select value={rule.mode} onChange={(event) => patchRule(index, { mode: event.target.value as RegexRule["mode"] })}>
                  <option value="replace">显式替换</option><option value="veil">隐式遮罩（点击显示）</option>
                </select></label>
                <fieldset className="target-grid">
                  <legend>应用位置</legend>
                  {targets.map((target) => <label key={target.value}><input type="checkbox" checked={rule.targets.includes(target.value)} onChange={() => toggleTarget(index, target.value)} /><span><strong>{target.label}</strong>{target.help && <small>{target.help}</small>}</span></label>)}
                </fieldset>
                <button className="icon-button danger-button" title="删除 Regex" aria-label={`删除 ${rule.name || "Regex"}`} onClick={() => setRegexRules((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>
                </div>
              </details>
            );
          })}
        </div>
        <button className="secondary-button full-button" onClick={() => setRegexRules((current) => [...current, { id: id("regex"), name: "新 Regex", enabled: true, scope: "session", pattern: "", flags: "g", replacement: "", targets: ["display"], mode: "replace" }])}><Plus size={15} />添加 Regex</button>
      </CollapsibleSection>

      <CollapsibleSection
        contentId="inspector-worldbooks-content"
        title="当前会话的世界书"
        icon={<GitFork size={16} />}
        storageKey="yggdrasil-tavern.inspector.worldbooks.expanded"
        className="inspector-section"
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

      <ContextPreviewPanel selectedSessionId={selectedSessionId} previewQuery={previewQuery} />
    </aside>
  );
}
