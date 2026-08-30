import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  GitFork,
  Globe2,
  GripVertical,
  Plus,
  RefreshCcw,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, PromptSlot, RegexRule, RegexTarget, SessionTree, WorldBook } from "../lib/api";
import { defaultPromptSlots, promptSlotsFromPreset, regexRulesFromPreset, worldbookIdsFromPreset } from "../lib/prompt";
import { validateRegex } from "../lib/regex";
import { sortMessages } from "../lib/tree";
import { CollapsibleSection } from "./CollapsibleSection";

type Props = {
  tree?: SessionTree;
  selectedSessionId: string | null;
  worldbooks: WorldBook[];
  onSessionUpdated?: () => void;
  onSelectMessage: (messageId: string) => Promise<void>;
  onCloseMobile?: () => void;
  onError?: (message: string) => void;
};

const defaultSlots = defaultPromptSlots();
const promptSlotDragType = "application/x-yggdrasil-prompt-slot";

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

function normalizeSlots(value: unknown): PromptSlot[] {
  return promptSlotsFromPreset({ prompt_slots: value });
}

function normalizeRegexRules(value: unknown): RegexRule[] {
  return regexRulesFromPreset({ regex_rules: value });
}

export function WorkspaceInspector({ tree, selectedSessionId, worldbooks, onSessionUpdated, onSelectMessage, onCloseMobile, onError }: Props) {
  const queryClient = useQueryClient();
  const [slots, setSlots] = useState<PromptSlot[]>(defaultSlots);
  const [promptRevision, setPromptRevision] = useState(0);
  const [regexRules, setRegexRules] = useState<RegexRule[]>([]);
  const [worldbookIds, setWorldbookIds] = useState<string[]>([]);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const globalPromptQuery = useQuery({
    queryKey: ["global-prompt-config"],
    queryFn: api.globalPromptConfig,
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });
  const previewQuery = useQuery({
    queryKey: ["context-preview", selectedSessionId, tree?.active_path_ids.join(":")],
    queryFn: () => api.contextPreview(selectedSessionId!),
    enabled: Boolean(selectedSessionId)
  });

  useEffect(() => {
    if (!globalPromptQuery.data) return;
    setSlots(normalizeSlots(globalPromptQuery.data.prompt_slots));
    setPromptRevision(globalPromptQuery.data.revision);
  }, [globalPromptQuery.data]);

  useEffect(() => {
    if (!tree) return;
    const preset = tree.session.preset || {};
    setRegexRules(normalizeRegexRules(preset.regex_rules));
    setWorldbookIds(worldbookIdsFromPreset(preset, tree.session.worldbook_id));
  }, [tree?.session.id]);

  const invalidRegexCount = useMemo(() => regexRules.filter((rule) => validateRegex(rule)).length, [regexRules]);

  function moveSlot(index: number, delta: number) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= slots.length) return;
    setSlots((current) => {
      const next = [...current];
      const [slot] = next.splice(index, 1);
      next.splice(nextIndex, 0, slot);
      return next;
    });
  }

  function patchSlot(index: number, patch: Partial<PromptSlot>) {
    setSlots((current) => current.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...patch } : slot));
  }

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

  async function saveGlobalPrompt() {
    setSavingPrompt(true);
    try {
      const saved = await api.updateGlobalPromptConfig({
        prompt_slots: slots,
        expected_revision: promptRevision
      });
      queryClient.setQueryData(["global-prompt-config"], saved);
      setSlots(normalizeSlots(saved.prompt_slots));
      setPromptRevision(saved.revision);
      await queryClient.invalidateQueries({ queryKey: ["context-preview"] });
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingPrompt(false);
    }
  }

  async function saveSessionConfiguration() {
    if (!tree || !selectedSessionId || invalidRegexCount) return;
    setSavingSession(true);
    try {
      const sessionPreset = { ...tree.session.preset };
      delete sessionPreset.prompt_slots;
      await api.updateSession(selectedSessionId, {
        worldbook_id: worldbookIds[0] || null,
        preset: {
          ...sessionPreset,
          worldbook_ids: worldbookIds,
          regex_rules: regexRules
        }
      });
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

      <CollapsibleSection
        contentId="inspector-global-prompt-content"
        title="全局 Prompt Profile"
        icon={<Globe2 size={16} />}
        storageKey="yggdrasil-tavern.inspector.global-prompt.expanded"
        className="inspector-section prompt-profile-section"
        headerMeta={<span className="quiet-badge">全部会话 · r{promptRevision}</span>}
      >
        <p className="section-help">这里的顺序、开关、role 和覆盖文本由所有会话共同使用；History 仍会读取各会话当前选中的真实树路径。</p>
        {globalPromptQuery.isPending && <p className="muted">正在读取全局 Prompt…</p>}
        {globalPromptQuery.error && <p className="field-error" role="alert">全局 Prompt 读取失败：{globalPromptQuery.error instanceof Error ? globalPromptQuery.error.message : String(globalPromptQuery.error)}</p>}
        <div className="slot-list">
          {slots.map((slot, index) => (
            <article
              key={slot.id}
              className={`slot-card slot-${slot.kind} ${slot.enabled ? "enabled" : "disabled"}`}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(promptSlotDragType)) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!event.dataTransfer.types.includes(promptSlotDragType)) return;
                event.preventDefault();
                if (draggedIndex === null || draggedIndex === index) return;
                setSlots((current) => {
                  const next = [...current];
                  const [moved] = next.splice(draggedIndex, 1);
                  next.splice(index, 0, moved);
                  return next;
                });
                setDraggedIndex(null);
              }}
            >
              <header className="slot-card-header">
                <button
                  type="button"
                  className="slot-drag-handle"
                  draggable
                  aria-label={`拖动 ${slot.name} 调整顺序`}
                  title="拖动调整顺序"
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(promptSlotDragType, slot.id);
                    setDraggedIndex(index);
                  }}
                  onDragEnd={() => setDraggedIndex(null)}
                ><GripVertical size={17} aria-hidden="true" /></button>
                <label className="form-field slot-name-field"><span>Prompt 名称</span><input value={slot.name} onChange={(event) => patchSlot(index, { name: event.target.value })} /></label>
                <button
                  className={`icon-button config-toggle ${slot.enabled ? "active" : ""}`}
                  aria-pressed={slot.enabled}
                  aria-label={slot.enabled ? `停用 ${slot.name}` : `启用 ${slot.name}`}
                  title={slot.enabled ? "已启用；点击停用" : "已停用；点击启用"}
                  onClick={() => patchSlot(index, { enabled: !slot.enabled })}
                >{slot.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button>
              </header>
              <div className="slot-toolbar">
                <label className="form-field compact-field"><span>消息角色</span><select value={slot.role || "system"} onChange={(event) => patchSlot(index, { role: event.target.value as PromptSlot["role"] })} disabled={slot.kind === "history"}>
                  <option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option>
                </select></label>
                <div className="slot-move-actions">
                  <button className="icon-button" aria-label={`上移 ${slot.name}`} title="上移" disabled={index === 0} onClick={() => moveSlot(index, -1)}><ArrowUp size={15} /></button>
                  <button className="icon-button" aria-label={`下移 ${slot.name}`} title="下移" disabled={index === slots.length - 1} onClick={() => moveSlot(index, 1)}><ArrowDown size={15} /></button>
                </div>
              </div>
              {slot.kind === "history" ? (
                <div className="history-slot"><GitFork size={16} />自动插入当前会话所选节点的完整祖先路径</div>
              ) : slot.content === null ? (
                <button className="dynamic-slot" onClick={() => patchSlot(index, { content: "" })}>使用每个会话的动态内容 · 点击设置全局覆盖</button>
              ) : (
                <label className="form-field"><span>全局覆盖内容</span><textarea value={slot.content} onChange={(event) => patchSlot(index, { content: event.target.value })} /><small>这段文本会替代该插槽原本从角色、世界书或会话读取的动态内容。</small></label>
              )}
              <footer>
                {slot.content !== null && slot.kind !== "custom" && <button className="secondary-button" onClick={() => patchSlot(index, { content: null })}>恢复动态内容</button>}
                {slot.kind === "custom" && <button className="icon-button danger-button" title="删除自定义 Prompt" aria-label={`删除 ${slot.name}`} onClick={() => setSlots((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>}
              </footer>
            </article>
          ))}
        </div>
        <button className="secondary-button full-button" onClick={() => setSlots((current) => [...current, { id: id("slot"), kind: "custom", name: "自定义 Prompt", enabled: true, role: "system", content: "" }])}><Plus size={15} />添加自定义 Prompt</button>
        <button className="primary-button full-button" disabled={savingPrompt || globalPromptQuery.isPending} onClick={saveGlobalPrompt}><Save size={16} />{savingPrompt ? "保存中…" : "保存全局 Prompt"}</button>
      </CollapsibleSection>

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
              <article className={`regex-rule-card ${rule.enabled ? "enabled" : "disabled"}`} key={rule.id}>
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
              </article>
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

      <button className="primary-button inspector-save" disabled={!tree || savingSession || invalidRegexCount > 0} onClick={saveSessionConfiguration}><Save size={16} />{savingSession ? "保存中…" : "保存当前会话 Regex 与世界书"}</button>

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

      <CollapsibleSection
        contentId="inspector-context-preview-content"
        title="最终 Prompt 预览"
        icon={<Eye size={16} />}
        storageKey="yggdrasil-tavern.inspector.context-preview.expanded"
        className="inspector-section"
      >
        <div className="context-preview">
          {previewQuery.isPending && selectedSessionId ? <p className="muted">正在编译预览…</p> : previewQuery.error ? <p className="field-error">{previewQuery.error instanceof Error ? previewQuery.error.message : String(previewQuery.error)}</p> : previewQuery.data ? (
            <><h3>System</h3><pre>{previewQuery.data.system}</pre><h3>Messages</h3><pre>{JSON.stringify(previewQuery.data.messages, null, 2)}</pre><h3>Activated Lore</h3><pre>{JSON.stringify(previewQuery.data.activated_lore, null, 2)}</pre></>
          ) : <p className="muted">选择会话后可查看最终发送给模型的 Prompt。</p>}
        </div>
      </CollapsibleSection>
    </aside>
  );
}
