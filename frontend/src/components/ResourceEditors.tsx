import { useQueryClient } from "@tanstack/react-query";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Download,
  FlipHorizontal2,
  FlipVertical2,
  MessageSquarePlus,
  Pencil,
  Plus,
  RotateCw,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { api, AvatarTransform, Character, CharacterSummary, ChatSession, WorldBook, WorldBookEntry } from "../lib/api";
import { ExpandableTextarea } from "./ExpandableTextarea";
import { CommaListInput } from "./CommaListInput";

type CommonProps = {
  onChanged: () => void;
  onError?: (message: string) => void;
};

const defaultTransform: AvatarTransform = { zoom: 1, offset_x: 0, offset_y: 0, rotation: 0, flip_x: false, flip_y: false };

export type EditorDraftState<T> = {
  draft: T | null;
  isDirty: boolean;
  error: string | null;
};

export function emptyEditorDraft<T>(): EditorDraftState<T> {
  return { draft: null, isDirty: false, error: null };
}

export function openEditorDraft<T>(value: T): EditorDraftState<T> {
  return { draft: structuredClone(value), isDirty: false, error: null };
}

export function modifyEditorDraft<T>(
  state: EditorDraftState<T>,
  updater: (current: T) => T
): EditorDraftState<T> {
  if (!state.draft) return state;
  return { ...state, draft: updater(state.draft), isDirty: true };
}

export function applyCharacterAvatarChange(
  current: Character,
  derived: string,
  original: string,
  transform: AvatarTransform
): Character {
  const nextExtensions = { ...(current.extensions || {}) };
  delete nextExtensions.yggdrasil_avatar;
  return {
    ...current,
    avatar_data_url: derived,
    avatar_original_data_url: original,
    avatar_transform: transform,
    extensions: nextExtensions
  };
}

export async function startCharacterSession(
  item: Pick<CharacterSummary, "id" | "name">,
  onCreateSession: (payload: Parameters<typeof api.createSession>[0]) => Promise<ChatSession>,
  onError?: (message: string) => void
): Promise<ChatSession | null> {
  try {
    return await onCreateSession({
      title: item.name,
      character_id: item.id,
      preset: { auto_greeting: true }
    });
  } catch (cause) {
    onError?.(cause instanceof Error ? cause.message : String(cause));
    return null;
  }
}

function temporaryId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dataUrlFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("头像读取结果不是 data URL"));
    reader.onerror = () => reject(reader.error || new Error("无法读取头像文件"));
    reader.readAsDataURL(file);
  });
}

// Closing an editor with unsaved changes asks first; Escape behaves like the close button.
function useEditorClose(open: boolean, dirty: boolean, close: () => void) {
  const requestClose = () => {
    if (!dirty || window.confirm("放弃未保存的修改？")) close();
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      requestCloseRef.current();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  return requestClose;
}

function EditorErrorBanner({ error, onDismiss }: { error: string | null; onDismiss: () => void }) {
  if (!error) return null;
  return (
    <div className="resource-modal-error" role="alert">
      <AlertCircle size={16} />
      <span>{error}</span>
      <button className="icon-button" type="button" title="关闭错误提示" aria-label="关闭错误提示" onClick={onDismiss}><X size={14} /></button>
    </div>
  );
}

function avatarMetadata(character: Character): { original: string; transform: AvatarTransform } {
  const embedded = character.extensions?.yggdrasil_avatar as { original_data_url?: string; transform?: AvatarTransform } | undefined;
  const stored = character.avatar_transform || embedded?.transform || {};
  return {
    original: character.avatar_original_data_url || embedded?.original_data_url || character.avatar_data_url || "",
    transform: { ...defaultTransform, ...stored }
  };
}

function AvatarEditor({ character, onApply, onError }: { character: Character; onApply: (derived: string, original: string, transform: AvatarTransform) => void; onError?: (message: string) => void }) {
  const metadata = avatarMetadata(character);
  const [original, setOriginal] = useState(metadata.original);
  const [transform, setTransformState] = useState<AvatarTransform>(metadata.transform);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Only a user edit derives a new avatar; opening the editor must not mark the draft dirty.
  const pendingApplyRef = useRef(false);

  function setTransform(next: AvatarTransform) {
    pendingApplyRef.current = true;
    setTransformState(next);
  }

  useEffect(() => {
    if (!original || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) {
      onError?.("浏览器无法创建头像 Canvas 2D context");
      return;
    }
    const image = new Image();
    image.onload = () => {
      const size = canvas.width;
      context.clearRect(0, 0, size, size);
      context.save();
      context.translate(size / 2 + transform.offset_x * size * 0.35, size / 2 + transform.offset_y * size * 0.35);
      context.rotate(transform.rotation * Math.PI / 180);
      const rotatedWidth = transform.rotation % 180 === 0 ? image.width : image.height;
      const rotatedHeight = transform.rotation % 180 === 0 ? image.height : image.width;
      const scale = Math.max(size / rotatedWidth, size / rotatedHeight) * transform.zoom;
      context.scale(transform.flip_x ? -1 : 1, transform.flip_y ? -1 : 1);
      context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale);
      context.restore();
      if (pendingApplyRef.current) {
        pendingApplyRef.current = false;
        apply();
      }
    };
    image.onerror = () => onError?.("头像图像无法解码，请换用 PNG/JPEG/WebP");
    image.src = original;
  }, [original, transform, onError]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setOriginal(await dataUrlFromFile(file));
      setTransform(defaultTransform);
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      event.target.value = "";
    }
  }

  function apply() {
    if (!canvasRef.current || !original) return;
    try {
      onApply(canvasRef.current.toDataURL("image/webp", 0.9), original, transform);
    } catch (cause) {
      onError?.(`头像派生图保存失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }

  return (
    <section className="avatar-editor">
      <div className="avatar-preview"><canvas ref={canvasRef} width={256} height={256} /></div>
      <div className="avatar-controls">
        <label className="file-button"><Upload size={15} />选择原图<input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} /></label>
        <label>缩放 {transform.zoom.toFixed(2)}<input type="range" min="1" max="3" step="0.05" value={transform.zoom} onChange={(event) => setTransform({ ...transform, zoom: Number(event.target.value) })} /></label>
        <label>水平裁剪位置<input type="range" min="-1" max="1" step="0.02" value={transform.offset_x} onChange={(event) => setTransform({ ...transform, offset_x: Number(event.target.value) })} /></label>
        <label>垂直裁剪位置<input type="range" min="-1" max="1" step="0.02" value={transform.offset_y} onChange={(event) => setTransform({ ...transform, offset_y: Number(event.target.value) })} /></label>
        <div className="inline-actions">
          <button className="icon-button" type="button" title="顺时针旋转 90°" onClick={() => setTransform({ ...transform, rotation: ((transform.rotation + 90) % 360) as AvatarTransform["rotation"] })}><RotateCw size={16} /></button>
          <button className={transform.flip_x ? "icon-button active-toggle" : "icon-button"} type="button" title="水平翻转" onClick={() => setTransform({ ...transform, flip_x: !transform.flip_x })}><FlipHorizontal2 size={16} /></button>
          <button className={transform.flip_y ? "icon-button active-toggle" : "icon-button"} type="button" title="垂直翻转" onClick={() => setTransform({ ...transform, flip_y: !transform.flip_y })}><FlipVertical2 size={16} /></button>
        </div>
      </div>
    </section>
  );
}

export function CharacterEditorDialog({
  draft,
  busy,
  error,
  onDismissError,
  onClose,
  onUpdate,
  onApplyAvatar,
  onAvatarError,
  onSave
}: {
  draft: Character;
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
  onClose: () => void;
  onUpdate: <K extends keyof Character>(field: K, value: Character[K]) => void;
  onApplyAvatar: (derived: string, original: string, transform: AvatarTransform) => void;
  onAvatarError: (message: string) => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="resource-modal" role="dialog" aria-modal="true" aria-label={`编辑角色 ${draft.name}`}>
        <header><div><h2>编辑本地角色</h2></div><button className="icon-button" type="button" title="关闭" aria-label="关闭角色编辑" onClick={onClose}><X size={17} /></button></header>
        <div className="resource-modal-body">
          <EditorErrorBanner error={error} onDismiss={onDismissError} />
          <AvatarEditor
            character={draft}
            onError={onAvatarError}
            onApply={onApplyAvatar}
          />
          <div className="editor-grid">
            <label>名称<input value={draft.name} onChange={(event) => onUpdate("name", event.target.value)} /></label>
            <label>作者<input value={draft.creator || ""} onChange={(event) => onUpdate("creator", event.target.value)} /></label>
            <label>版本<input value={draft.character_version || ""} onChange={(event) => onUpdate("character_version", event.target.value)} /></label>
            <label>标签（逗号分隔）<CommaListInput value={draft.tags || []} onChange={(tags) => onUpdate("tags", tags)} /></label>
          </div>
          {!!draft.import_warnings?.length && <div role="status"><strong>角色卡世界书导入提示</strong><ul>{draft.import_warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
          {([
            ["description", "角色描述", 220], ["personality", "性格", 220], ["scenario", "场景", 220], ["first_mes", "首条消息", 220],
            ["mes_example", "示例对话", 220], ["system_prompt", "角色 System Prompt", 160], ["post_history_instructions", "Post-History Instruction", 160], ["creator_notes", "作者备注", 160]
          ] as Array<[keyof Character, string, number]>).map(([field, label, minHeight]) => (
            <ExpandableTextarea
              key={field}
              label={label}
              value={String(draft[field] || "")}
              minHeight={minHeight}
              onChange={(value) => onUpdate(field, value)}
            />
          ))}
          <fieldset className="alternate-greetings"><legend>备选开场白（每条成为一个根级分支）</legend>
            {(draft.alternate_greetings || []).map((greeting, index) => <div key={index}><ExpandableTextarea label={`备选开场白 ${index + 1}`} value={greeting} minHeight={160} onChange={(value) => onUpdate("alternate_greetings", draft.alternate_greetings.map((item, itemIndex) => itemIndex === index ? value : item))} /><button className="icon-button danger-button" type="button" title="删除这条备选开场白" aria-label={`删除备选开场白 ${index + 1}`} onClick={() => onUpdate("alternate_greetings", draft.alternate_greetings.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}
            <button className="secondary-button" type="button" onClick={() => onUpdate("alternate_greetings", [...(draft.alternate_greetings || []), ""])}><Plus size={15} />添加备选开场白</button>
          </fieldset>
        </div>
        <footer><button className="primary-button" type="button" disabled={busy || !draft.name.trim()} onClick={onSave}><Save size={16} />保存本地角色</button></footer>
      </section>
    </div>
  );
}

export function CharacterManager({
  characters,
  onChanged,
  onError,
  openRequestId,
  onCreateSession,
  creatingSession = false
}: CommonProps & {
  characters: CharacterSummary[];
  openRequestId?: string | null;
  onCreateSession?: (payload: Parameters<typeof api.createSession>[0]) => Promise<ChatSession>;
  creatingSession?: boolean;
}) {
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<EditorDraftState<Character>>(emptyEditorDraft);
  const [busy, setBusy] = useState(false);
  const [creatingForId, setCreatingForId] = useState<string | null>(null);
  const requestClose = useEditorClose(Boolean(editor.draft), Boolean(editor.draft) && editor.isDirty, () => setEditor(emptyEditorDraft()));

  useEffect(() => {
    if (openRequestId) void openEditor(openRequestId);
  }, [openRequestId]);

  async function openEditor(characterId: string) {
    setBusy(true);
    try {
      const character = await queryClient.fetchQuery({ queryKey: ["character", characterId], queryFn: () => api.character(characterId), staleTime: Infinity });
      setEditor(openEditorDraft(character));
    } catch (cause) {
      setEditor(emptyEditorDraft());
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const draft = editor.draft;
    if (!draft) return;
    setBusy(true);
    setEditor((current) => ({ ...current, error: null }));
    try {
      await api.updateCharacter(draft.id, draft);
      await queryClient.invalidateQueries({ queryKey: ["character", draft.id] });
      onChanged();
      setEditor(emptyEditorDraft());
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setEditor((current) => ({ ...current, error: `保存失败：${detail}` }));
      onError?.(detail);
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: CharacterSummary) {
    if (!window.confirm(`删除本地角色“${item.name}”？`)) return;
    try {
      await api.deleteCharacter(item.id);
      onChanged();
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function handleCreateSession(item: CharacterSummary) {
    if (!onCreateSession || creatingSession || creatingForId !== null) return;
    setCreatingForId(item.id);
    try {
      await startCharacterSession(item, onCreateSession, onError);
    } finally {
      setCreatingForId(null);
    }
  }

  function update<K extends keyof Character>(field: K, value: Character[K]) {
    setEditor((current) => modifyEditorDraft(current, (draft) => ({ ...draft, [field]: value })));
  }

  return (
    <>
      <div className="resource-list">
        {characters.map((item) => (
          <div className="resource-row resource-row-character" key={item.id}>
            {item.avatar_data_url ? <img src={item.avatar_data_url} alt="" /> : <span className="avatar-placeholder">{item.name.slice(0, 1)}</span>}
            <span>{item.name}</span>
            <button
              className="icon-button"
              type="button"
              title="用此角色新建会话"
              aria-label="用此角色新建会话"
              disabled={!onCreateSession || busy || creatingSession || creatingForId !== null}
              onClick={() => void handleCreateSession(item)}
            >
              <MessageSquarePlus size={15} />
            </button>
            <button className="icon-button" type="button" title="编辑角色" disabled={busy} onClick={() => void openEditor(item.id)}><Pencil size={15} /></button>
            <button className="icon-button" type="button" title="导出角色卡 JSON" onClick={() => api.exportCharacter(item.id, `${item.name}.json`).catch((cause) => onError?.(cause instanceof Error ? cause.message : String(cause)))}><Download size={15} /></button>
            <button className="icon-button danger-button" type="button" title="删除角色" onClick={() => void remove(item)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      {editor.draft && (
        <CharacterEditorDialog
          draft={editor.draft}
          busy={busy}
          error={editor.error}
          onDismissError={() => setEditor((current) => ({ ...current, error: null }))}
          onClose={requestClose}
          onUpdate={update}
          onAvatarError={(detail) => {
            setEditor((current) => ({ ...current, error: detail }));
            onError?.(detail);
          }}
          onApplyAvatar={(derived, original, transform) => setEditor((current) => modifyEditorDraft(
            current,
            (draft) => applyCharacterAvatarChange(draft, derived, original, transform)
          ))}
          onSave={() => void save()}
        />
      )}
    </>
  );
}

function newEntry(worldbookId: string): WorldBookEntry {
  return { id: temporaryId("entry"), worldbook_id: worldbookId, keys: [], secondary_keys: [], content: "", enabled: true, constant: false, selective: false, order: 100, position: "after_char", uid: null, depth: null, case_sensitive: false, match_whole_words: false, exclude_recursion: false, prevent_recursion: false, delay_until_recursion: 0, raw_json: {} };
}

export function WorldbookEditorDialog({
  draft,
  busy,
  error,
  onDismissError,
  onClose,
  onUpdateBook,
  onPatchEntry,
  onDeleteEntry,
  onAddEntry,
  onSave
}: {
  draft: WorldBook;
  busy: boolean;
  error: string | null;
  onDismissError: () => void;
  onClose: () => void;
  onUpdateBook: (patch: Partial<WorldBook>) => void;
  onPatchEntry: (index: number, patch: Partial<WorldBookEntry>) => void;
  onDeleteEntry: (index: number) => void;
  onAddEntry: () => void;
  onSave: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="resource-modal worldbook-modal" role="dialog" aria-modal="true" aria-label={`编辑世界书 ${draft.name}`}>
        <header><div><p className="eyebrow">World Book</p><h2>编辑世界书与条目</h2></div><button className="icon-button" type="button" title="关闭" aria-label="关闭世界书编辑" onClick={onClose}><X size={17} /></button></header>
        <div className="resource-modal-body">
          <EditorErrorBanner error={error} onDismiss={onDismissError} />
          <div className="editor-grid"><label>名称<input value={draft.name} onChange={(event) => onUpdateBook({ name: event.target.value })} /></label><label>扫描最近消息数<input type="number" min="0" value={draft.scan_depth} onChange={(event) => onUpdateBook({ scan_depth: Number(event.target.value) })} /></label><label>激活内容 Token 上限<input type="number" min="0" value={draft.token_budget} onChange={(event) => onUpdateBook({ token_budget: Number(event.target.value) })} /></label></div>
          <div className="editor-grid">
            <label><input type="checkbox" checked={draft.recursive_scanning} onChange={(event) => onUpdateBook({ recursive_scanning: event.target.checked })} />递归扫描<small>用已激活条目的内容继续匹配其他条目的关键词。</small></label>
            <label>最大扫描轮数<input type="number" min="0" step="1" value={draft.max_recursion_steps ?? 0} onChange={(event) => onUpdateBook({ max_recursion_steps: Number(event.target.value) })} /><small>包含首次扫描；0 表示不限轮数，1 表示只扫描一次。</small></label>
          </div>
          {!!draft.import_warnings?.length && <div role="status"><strong>世界书导入提示</strong><ul>{draft.import_warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
          <label>描述<textarea value={draft.description} onChange={(event) => onUpdateBook({ description: event.target.value })} /></label>
          <div className="worldbook-entry-list">
            {draft.entries.map((entry, index) => (
              <article className="worldbook-entry-card" key={entry.id || index}>
                <header><strong>条目 {index + 1}</strong><button className={`icon-button config-toggle ${entry.enabled ? "active" : ""}`} type="button" aria-pressed={entry.enabled} aria-label={entry.enabled ? `停用条目 ${index + 1}` : `启用条目 ${index + 1}`} title={entry.enabled ? "已启用；点击停用" : "已停用；点击启用"} onClick={() => onPatchEntry(index, { enabled: !entry.enabled })}>{entry.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button><button className="icon-button danger-button" type="button" title="删除条目" onClick={() => onDeleteEntry(index)}><Trash2 size={15} /></button></header>
                <label>主关键词（逗号分隔）<CommaListInput value={entry.keys} onChange={(keys) => onPatchEntry(index, { keys })} /></label>
                <label>次关键词（逗号分隔）<CommaListInput value={entry.secondary_keys} onChange={(secondary_keys) => onPatchEntry(index, { secondary_keys })} /><small>开启“需次关键词”后，还必须命中这里的任一项。</small></label>
                <label>内容<textarea value={entry.content} onChange={(event) => onPatchEntry(index, { content: event.target.value })} /></label>
                <div className="editor-grid">
                  <label>条目扫描深度（最近消息数）<input type="number" min="0" step="1" placeholder="继承世界书设置" value={entry.depth ?? ""} onChange={(event) => onPatchEntry(index, { depth: event.target.value === "" ? null : Number(event.target.value) })} /><small>留空继承世界书设置；这是关键词扫描范围。</small></label>
                  <label>递归延迟等级<input type="number" min="0" step="1" value={entry.delay_until_recursion ?? 0} onChange={(event) => onPatchEntry(index, { delay_until_recursion: Number(event.target.value) })} /><small>0 可在首次扫描激活；正数仅在递归扫描中生效，较低等级先完成。</small></label>
                  <label><input type="checkbox" checked={entry.exclude_recursion ?? false} onChange={(event) => onPatchEntry(index, { exclude_recursion: event.target.checked })} />不由递归激活<small>只允许直接匹配对话中的关键词。</small></label>
                  <label><input type="checkbox" checked={entry.prevent_recursion ?? false} onChange={(event) => onPatchEntry(index, { prevent_recursion: event.target.checked })} />不触发后续递归<small>该条目激活后，其内容不用于激活其他条目。</small></label>
                </div>
                <div className="entry-options"><label>插入顺序<input type="number" value={entry.order} onChange={(event) => onPatchEntry(index, { order: Number(event.target.value) })} /><small>数字较小的条目先插入。</small></label><label>插入位置<select value={entry.position} onChange={(event) => onPatchEntry(index, { position: event.target.value })}><option value="before_char">角色设定之前</option><option value="after_char">角色设定之后</option></select></label><label title="不检查关键词，每次都插入"><input type="checkbox" checked={entry.constant} onChange={(event) => onPatchEntry(index, { constant: event.target.checked })} />始终插入</label><label title="主关键词命中后还需要次关键词"><input type="checkbox" checked={entry.selective} onChange={(event) => onPatchEntry(index, { selective: event.target.checked })} />需次关键词</label><label><input type="checkbox" checked={entry.case_sensitive} onChange={(event) => onPatchEntry(index, { case_sensitive: event.target.checked })} />区分大小写</label><label><input type="checkbox" checked={entry.match_whole_words} onChange={(event) => onPatchEntry(index, { match_whole_words: event.target.checked })} />仅匹配完整词</label></div>
              </article>
            ))}
          </div>
          <button className="secondary-button full-button" type="button" onClick={onAddEntry}><Plus size={15} />添加世界书条目</button>
        </div>
        <footer><button className="primary-button" type="button" disabled={busy || !draft.name.trim()} onClick={onSave}><Save size={16} />保存世界书</button></footer>
      </section>
    </div>
  );
}

export function WorldbookManager({
  worldbooks,
  onChanged,
  onError,
  openBook
}: CommonProps & { worldbooks: WorldBook[]; openBook?: WorldBook | null }) {
  const [editor, setEditor] = useState<EditorDraftState<WorldBook>>(emptyEditorDraft);
  const [busy, setBusy] = useState(false);
  const requestClose = useEditorClose(Boolean(editor.draft), Boolean(editor.draft) && editor.isDirty, () => setEditor(emptyEditorDraft()));

  useEffect(() => {
    if (openBook) setEditor(openEditorDraft(openBook));
  }, [openBook]);

  async function save() {
    const draft = editor.draft;
    if (!draft) return;
    setBusy(true);
    setEditor((current) => ({ ...current, error: null }));
    try {
      await api.updateWorldbook(draft.id, draft);
      onChanged();
      setEditor(emptyEditorDraft());
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setEditor((current) => ({ ...current, error: `保存失败：${detail}` }));
      onError?.(detail);
    } finally {
      setBusy(false);
    }
  }

  async function remove(book: WorldBook) {
    if (!window.confirm(`删除世界书“${book.name}”及其全部条目？`)) return;
    try {
      await api.deleteWorldbook(book.id);
      onChanged();
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function updateBook(patch: Partial<WorldBook>) {
    setEditor((current) => modifyEditorDraft(current, (draft) => ({ ...draft, ...patch })));
  }

  function patchEntry(index: number, patch: Partial<WorldBookEntry>) {
    setEditor((current) => modifyEditorDraft(current, (draft) => ({
      ...draft,
      entries: draft.entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry)
    })));
  }

  return (
    <>
      <div className="resource-list">
        {worldbooks.map((book) => <div className="resource-row" key={book.id}><span className="book-badge">WB</span><span>{book.name} · {book.entries.length} 条</span><button className="icon-button" type="button" title="编辑世界书" onClick={() => setEditor(openEditorDraft(book))}><Pencil size={15} /></button><button className="icon-button" type="button" title="导出世界书" onClick={() => api.exportWorldbook(book.id, `${book.name}.json`).catch((cause) => onError?.(cause instanceof Error ? cause.message : String(cause)))}><Download size={15} /></button><button className="icon-button danger-button" type="button" title="删除世界书" onClick={() => void remove(book)}><Trash2 size={15} /></button></div>)}
      </div>
      {editor.draft && (
        <WorldbookEditorDialog
          draft={editor.draft}
          busy={busy}
          error={editor.error}
          onDismissError={() => setEditor((current) => ({ ...current, error: null }))}
          onClose={requestClose}
          onUpdateBook={updateBook}
          onPatchEntry={patchEntry}
          onDeleteEntry={(index) => updateBook({ entries: editor.draft!.entries.filter((_, itemIndex) => itemIndex !== index) })}
          onAddEntry={() => updateBook({ entries: [...editor.draft!.entries, newEntry(editor.draft!.id)] })}
          onSave={() => void save()}
        />
      )}
    </>
  );
}
