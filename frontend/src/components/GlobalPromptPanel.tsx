import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GitFork, Globe2, GripVertical, Plus, Save, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { api, PromptSlot } from "../lib/api";
import { defaultPromptSlots, promptSlotsFromPreset } from "../lib/prompt";
import { CollapsibleSection } from "./CollapsibleSection";

type Props = { onError?: (message: string) => void };

const defaultSlots = defaultPromptSlots();
const promptSlotDragType = "application/x-yggdrasil-prompt-slot";

function id(prefix: string): string {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random()}`;
}

function normalizeSlots(value: unknown): PromptSlot[] {
  return promptSlotsFromPreset({ prompt_slots: value });
}

export function GlobalPromptPanel({ onError }: Props) {
  const queryClient = useQueryClient();
  const [slots, setSlots] = useState<PromptSlot[]>(defaultSlots);
  const [promptRevision, setPromptRevision] = useState(0);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const globalPromptQuery = useQuery({
    queryKey: ["global-prompt-config"],
    queryFn: api.globalPromptConfig,
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });
  useEffect(() => {
    if (!globalPromptQuery.data) return;
    setSlots(normalizeSlots(globalPromptQuery.data.prompt_slots));
    setPromptRevision(globalPromptQuery.data.revision);
  }, [globalPromptQuery.data]);

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

  return (
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

  );
}
