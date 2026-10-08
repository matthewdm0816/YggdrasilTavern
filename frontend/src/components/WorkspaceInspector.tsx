import { useQuery } from "@tanstack/react-query";
import { Eye, GitFork, Plus, RefreshCcw, Save, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type SetStateAction } from "react";
import { api, RegexRule, RegexTarget, SessionTree, WorldBook } from "../lib/api";
import { markSettingsSaved, reconcileSettingsDrafts, resetSettingsDraft, settingsConflict, settingsFromTree, updateSettingsDraft, type SessionSettingsDrafts } from "../features/chat/sessionSettingsDraft";
import { validateRegex } from "../lib/regex";
import { sortMessages } from "../lib/tree";
import { CollapsibleSection } from "./CollapsibleSection";
import { GlobalPromptPanel } from "./GlobalPromptPanel";
import { ContextPreviewPanel } from "./ContextPreviewPanel";

type Props = {
  tree?: SessionTree;
  selectedSessionId: string | null;
  activeProfileId: string;
  worldbooks: WorldBook[];
  onSessionUpdated?: () => Promise<void>;
  onSelectMessage: (messageId: string) => Promise<void>;
  onCloseMobile?: () => void;
  onError?: (message: string) => void;
};

const targets: Array<{ value: RegexTarget; label: string; help: string }> = [
  { value: "display", label: "聊天显示", help: "只改变你看到的文本，不改原消息。" },
  { value: "user_input", label: "用户消息", help: "处理界面中的用户消息。" },
  { value: "assistant_output", label: "角色回复", help: "处理界面中的模型回复。" },
  { value: "outgoing_prompt", label: "发送给模型的 Prompt", help: "编译 Prompt 时显式替换；不能使用遮罩模式。" }
];

const regexFlagOptions = [
  { flag: "g", label: "替换全部命中", help: "关闭时，每段文本只替换第一个命中。" },
  { flag: "i", label: "忽略大小写", help: "例如 A 和 a 会被视为相同。" },
  { flag: "m", label: "按行匹配开头与结尾", help: "让 ^ 和 $ 对每一行分别生效。" },
  { flag: "s", label: "点号可以跨行", help: "让 . 也能匹配换行符。" }
] as const;

function id(prefix: string): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random()}`;
}

 export function WorkspaceInspector({ tree, selectedSessionId, activeProfileId, worldbooks, onSessionUpdated, onSelectMessage, onCloseMobile, onError }: Props) {

  const [settingsDrafts, setSettingsDrafts] = useState<SessionSettingsDrafts>({});
  const [savingSession, setSavingSession] = useState(false);
  const currentTree = tree?.session.id === selectedSessionId ? tree : undefined;
  const currentDraft = selectedSessionId ? settingsDrafts[selectedSessionId] : undefined;
  const remoteSettings = currentTree ? settingsFromTree(currentTree) : undefined;
  const regexRules = currentDraft?.value.regexRules || remoteSettings?.regexRules || [];
  const worldbookIds = currentDraft?.value.worldbookIds || remoteSettings?.worldbookIds || [];
  const hasSettingsConflict = currentDraft ? settingsConflict(currentDraft) : false;

  const previewQuery = useQuery({
    queryKey: ["context-preview", selectedSessionId, activeProfileId, tree?.active_path_ids.join(":")],
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
    if (!currentTree || !selectedSessionId || invalidRegexCount || hasSettingsConflict) return;
    setSavingSession(true);
    try {
      const sessionPreset = { ...currentTree.session.preset };
      delete sessionPreset.prompt_slots;
      await api.updateSession(selectedSessionId, {
        worldbook_id: worldbookIds[0] || null,
        preset: {
          ...sessionPreset,
          worldbook_ids: worldbookIds,
          regex_rules: regexRules
        }
      });
      setSettingsDrafts((current) => markSettingsSaved(current, selectedSessionId));
      await onSessionUpdated?.();
      await previewQuery.refetch();
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingSession(false);
    }
  }

  function renderBranch(parentId: string | null, depth = 0): React.ReactNode {
    if (!tree) return null;
    return sortMessages(tree.messages.filter((message) => message.parent_id === parentId)).map((message) => {
      const active = tree.active_path_ids.includes(message.id);
      return (
        <div key={message.id}>
          <button
            className={active ? "branch-node active" : "branch-node"}
            style={{ paddingLeft: 10 + depth * 16 }}
            onClick={() => void onSelectMessage(message.id).catch((cause) => onError?.(cause instanceof Error ? cause.message : String(cause)))}
            title="切换到此节点所在分支"
          >
            <span>{message.role === "assistant" ? "A" : message.role === "user" ? "U" : "S"}</span>
            <p>{message.content || "空消息"}</p>
          </button>
          {renderBranch(message.id, depth + 1)}
        </div>
      );
    });
  }

  return (
    <aside className="right-pane">
      <header className="pane-header">
        <div><p className="eyebrow">Inspector</p><h2>Prompt、Regex 与分支</h2></div>
        <div className="pane-header-actions"><button className="icon-button" title="刷新当前会话上下文" aria-label="刷新当前会话上下文" disabled={!selectedSessionId} onClick={() => previewQuery.refetch()}><RefreshCcw size={17} /></button>{onCloseMobile && <button className="icon-button mobile-pane-close" title="关闭 Inspector" aria-label="关闭 Inspector" onClick={onCloseMobile}><X size={17} /></button>}</div>
      </header>

      <GlobalPromptPanel onError={onError} />

      <CollapsibleSection
        contentId="inspector-regex-content"
        title="当前会话 Regex"
        icon={<Eye size={16} />}
        storageKey="yggdrasil-tavern.inspector.regex.expanded"
        className="inspector-section"
      >
        <p className="section-help">显式替换会显示替换后的文本；隐式遮罩保留原文，悬浮或点击才揭示。两种方式都不会改写原始 Message.content。</p>
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
                <label className="form-field"><span>查找规则（正则表达式）</span><input value={rule.pattern} onChange={(event) => patchRule(index, { pattern: event.target.value })} /><small>例如：\\*\\*(.*?)\\*\\* 会匹配两个 ** 之间的内容。</small></label>
                {validation && <p className="field-error" role="alert">{validation}</p>}
                <label className="form-field"><span>替换内容</span><input value={rule.replacement} onChange={(event) => patchRule(index, { replacement: event.target.value })} /><small>可用 $1、$2 引用查找规则中的分组；遮罩模式下这是揭示后显示的文本。</small></label>
                <fieldset className="regex-flags">
                  <legend>匹配选项</legend>
                  {regexFlagOptions.map((option) => (
                    <label key={option.flag}>
                      <input type="checkbox" checked={rule.flags.includes(option.flag)} onChange={() => toggleRegexFlag(index, option.flag)} />
                      <span><strong>{option.label}</strong><small>{option.help}</small></span>
                    </label>
                  ))}
                </fieldset>
                <label className="form-field"><span>处理方式</span><select value={rule.mode} onChange={(event) => patchRule(index, { mode: event.target.value as RegexRule["mode"] })}>
                  <option value="replace">显式替换</option><option value="veil">隐式遮罩段落</option>
                </select></label>
                <fieldset className="target-grid">
                  <legend>应用位置</legend>
                  {targets.map((target) => <label key={target.value}><input type="checkbox" checked={rule.targets.includes(target.value)} onChange={() => toggleTarget(index, target.value)} /><span><strong>{target.label}</strong><small>{target.help}</small></span></label>)}
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
        <p className="section-help">可同时绑定多本；每个会话保存自己的选择。</p>
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
      <button className="primary-button inspector-save" disabled={!currentTree || savingSession || invalidRegexCount > 0 || hasSettingsConflict} onClick={saveSessionConfiguration}><Save size={16} />{savingSession ? "保存中…" : "保存当前会话 Regex 与世界书"}</button>

      <CollapsibleSection
        contentId="inspector-branch-map-content"
        title="分支地图"
        icon={<GitFork size={16} />}
        storageKey="yggdrasil-tavern.inspector.branch-map.expanded"
        className="inspector-section"
        defaultExpanded
      >
        <div className="branch-map">{tree ? renderBranch(null) : <p className="muted">暂无会话树。</p>}</div>
      </CollapsibleSection>

      <ContextPreviewPanel selectedSessionId={selectedSessionId} previewQuery={previewQuery} />
    </aside>
  );
}
