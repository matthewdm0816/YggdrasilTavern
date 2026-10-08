import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GitFork, Globe2, GripVertical, Plus, Save, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { api, PromptSlot } from "../lib/api";
import { defaultPromptSlots, promptSlotsFromPreset } from "../lib/prompt";
import { reconcileSavedPromptSlots, samePromptSlots } from "../features/chat/globalPromptDraft";
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
  const savingPromptRef = useRef(false);
  const [savedSlots, setSavedSlots] = useState<PromptSlot[]>(defaultSlots);
  const savedSlotsRef = useRef<PromptSlot[]>(defaultSlots);
  const [saveFeedback, setSaveFeedback] = useState<{ saved: boolean; error?: string } | null>(null);
  const hasPromptChanges = !samePromptSlots(slots, savedSlots);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const globalPromptQuery = useQuery({
    queryKey: ["global-prompt-config"],
    queryFn: api.globalPromptConfig,
    staleTime: Infinity,
    refetchOnWindowFocus: false
  });
  const importedPrompts = useQuery({
    queryKey: ["imported-resources", "prompt"], queryFn: () => api.importedResources("prompt")
  });
  const [importedPromptId, setImportedPromptId] = useState("");
  useEffect(() => {
    if (!globalPromptQuery.data) return;
    const incoming = normalizeSlots(globalPromptQuery.data.prompt_slots);
    const previousBaseline = savedSlotsRef.current;
    setSlots((current) => samePromptSlots(current, previousBaseline) ? incoming : current);
    setSavedSlots(incoming);
    savedSlotsRef.current = incoming;
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
    if (!hasPromptChanges || globalPromptQuery.isPending || globalPromptQuery.error || savingPromptRef.current) return;
    const submitted = slots;
    savingPromptRef.current = true;
    setSavingPrompt(true);
    setSaveFeedback(null);
    try {
      const saved = await api.updateGlobalPromptConfig({
        prompt_slots: submitted,
        expected_revision: promptRevision
      });
      const incoming = normalizeSlots(saved.prompt_slots);
      setSlots((current) => reconcileSavedPromptSlots(current, submitted, incoming));
      setSavedSlots(incoming);
      savedSlotsRef.current = incoming;
      setPromptRevision(saved.revision);
      queryClient.setQueryData(["global-prompt-config"], saved);
      setSaveFeedback({ saved: true });
      try {
        await queryClient.invalidateQueries({ queryKey: ["context-preview"] }, { throwOnError: true });
      } catch (cause) {
        const message = `全局 Prompt 已保存，但刷新上下文失败：${cause instanceof Error ? cause.message : String(cause)}`;
        setSaveFeedback({ saved: true, error: message });
        onError?.(message);
      }
    } catch (cause) {
      const message = `全局 Prompt 保存失败：${cause instanceof Error ? cause.message : String(cause)}`;
      setSaveFeedback({ saved: false, error: message });
      onError?.(message);
    } finally {
      savingPromptRef.current = false;
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

        {!!importedPrompts.data?.length && <label className="form-field"><span>导入的 SillyTavern 提示词预设</span><select value={importedPromptId} onChange={(event) => {
          const value = event.target.value;
          setImportedPromptId(value);
          const preset = importedPrompts.data?.find((item) => item.id === value);
          if (preset) setSlots(normalizeSlots(preset.converted.prompt_slots));
        }}><option value="">选择预设</option>{importedPrompts.data.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        {importedPrompts.error && <p className="field-error">导入的提示词预设读取失败：{importedPrompts.error instanceof Error ? importedPrompts.error.message : String(importedPrompts.error)}</p>}
        {importedPrompts.data?.find((item) => item.id === importedPromptId)?.warnings.map((warning, index) => <p className="section-help" key={index}>{warning}</p>)}
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
                <div className="history-slot"><GitFork size={16} />当前会话历史</div>
              ) : slot.content === null ? (
                <button className="dynamic-slot" onClick={() => patchSlot(index, { content: "" })}>设置全局覆盖</button>
              ) : (
                <label className="form-field"><span>全局覆盖内容</span><textarea value={slot.content} onChange={(event) => patchSlot(index, { content: event.target.value })} /></label>
              )}
              <footer>
                {slot.content !== null && slot.kind !== "custom" && <button className="secondary-button" onClick={() => patchSlot(index, { content: null })}>恢复动态内容</button>}
                {slot.kind === "custom" && <button className="icon-button danger-button" title="删除自定义 Prompt" aria-label={`删除 ${slot.name}`} onClick={() => setSlots((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button>}
              </footer>
            </article>
          ))}
        </div>
        <button className="secondary-button full-button" onClick={() => setSlots((current) => [...current, { id: id("slot"), kind: "custom", name: "自定义 Prompt", enabled: true, role: "system", content: "" }])}><Plus size={15} />添加自定义 Prompt</button>
        <button type="button" className={`${hasPromptChanges ? "primary-button" : "secondary-button"} full-button`} disabled={!hasPromptChanges || savingPrompt || globalPromptQuery.isPending || Boolean(globalPromptQuery.error)} onClick={() => void saveGlobalPrompt()}><Save size={16} />{savingPrompt ? "保存中…" : "保存全局 Prompt"}</button>
        <p className="save-feedback" role="status" aria-live="polite">{savingPrompt ? "正在保存提交的全局 Prompt…" : hasPromptChanges ? (saveFeedback?.saved ? "上次修改已保存，当前还有未保存修改。" : "有未保存修改。") : saveFeedback?.saved ? "全局 Prompt 已保存。" : "全局 Prompt 未修改。"}</p>
        {saveFeedback?.error && <p className="field-error" role="alert">{saveFeedback.error}</p>}

      </CollapsibleSection>

  );
}
