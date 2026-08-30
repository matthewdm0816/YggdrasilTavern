import { ChangeEvent, useEffect, useRef, useState } from "react";
import { Download, FlipHorizontal2, FlipVertical2, Pencil, Plus, RotateCw, Save, ToggleLeft, ToggleRight, Trash2, Upload, X } from "lucide-react";
import { api, AvatarTransform, Character, CharacterSummary, WorldBook, WorldBookEntry } from "../lib/api";

type CommonProps = {
  onChanged: () => void;
  onError?: (message: string) => void;
};

const defaultTransform: AvatarTransform = { zoom: 1, offset_x: 0, offset_y: 0, rotation: 0, flip_x: false, flip_y: false };

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
  const [transform, setTransform] = useState<AvatarTransform>(metadata.transform);
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
          <button className="icon-button" title="顺时针旋转 90°" onClick={() => setTransform({ ...transform, rotation: ((transform.rotation + 90) % 360) as AvatarTransform["rotation"] })}><RotateCw size={16} /></button>
          <button className={transform.flip_x ? "icon-button active-toggle" : "icon-button"} title="水平翻转" onClick={() => setTransform({ ...transform, flip_x: !transform.flip_x })}><FlipHorizontal2 size={16} /></button>
          <button className={transform.flip_y ? "icon-button active-toggle" : "icon-button"} title="垂直翻转" onClick={() => setTransform({ ...transform, flip_y: !transform.flip_y })}><FlipVertical2 size={16} /></button>
          <button className="secondary-button" disabled={!original} onClick={apply}>应用裁剪</button>
        </div>
      </div>
    </section>
  );
}

export function CharacterManager({ characters, onChanged, onError }: CommonProps & { characters: CharacterSummary[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Character | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editingId) setDraft(null);
  }, [editingId]);

  async function openEditor(characterId: string) {
    setBusy(true);
    setEditingId(characterId);
    try {
      setDraft(await api.character(characterId));
    } catch (cause) {
      setEditingId(null);
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await api.updateCharacter(draft.id, draft);
      onChanged();
      setEditingId(null);
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: CharacterSummary) {
    if (!window.confirm(`删除本地角色“${item.name}”？已存在会话不会被删除。`)) return;
    try {
      await api.deleteCharacter(item.id);
      onChanged();
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function update(field: keyof Character, value: Character[keyof Character]) {
    setDraft((current) => current ? { ...current, [field]: value } : current);
  }

  return (
    <>
      <div className="resource-list">
        {characters.map((item) => (
          <div className="resource-row" key={item.id}>
            {item.avatar_data_url ? <img src={item.avatar_data_url} alt="" /> : <span className="avatar-placeholder">{item.name.slice(0, 1)}</span>}
            <span>{item.name}</span>
            <button className="icon-button" title="编辑角色" disabled={busy} onClick={() => openEditor(item.id)}><Pencil size={15} /></button>
            <button className="icon-button" title="导出角色卡 JSON" onClick={() => api.exportCharacter(item.id, `${item.name}.json`).catch((cause) => onError?.(cause instanceof Error ? cause.message : String(cause)))}><Download size={15} /></button>
            <button className="icon-button danger-button" title="删除角色" onClick={() => remove(item)}><Trash2 size={15} /></button>
          </div>
        ))}
      </div>
      {draft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditingId(null)}>
          <section className="resource-modal" role="dialog" aria-modal="true" aria-label={`编辑角色 ${draft.name}`}>
            <header><div><p className="eyebrow">Normalized Character</p><h2>编辑本地角色</h2></div><button className="icon-button" title="关闭" onClick={() => setEditingId(null)}><X size={17} /></button></header>
            <div className="resource-modal-body">
              <AvatarEditor
                character={draft}
                onError={onError}
                onApply={(derived, original, transform) => setDraft({
                  ...draft,
                  avatar_data_url: derived,
                  avatar_original_data_url: original,
                  avatar_transform: transform,
                  extensions: { ...draft.extensions, yggdrasil_avatar: { original_data_url: original, transform } }
                })}
              />
              <div className="editor-grid">
                <label>名称<input value={draft.name} onChange={(event) => update("name", event.target.value)} /></label>
                <label>作者<input value={draft.creator || ""} onChange={(event) => update("creator", event.target.value)} /></label>
                <label>版本<input value={draft.character_version || ""} onChange={(event) => update("character_version", event.target.value)} /></label>
                <label>标签（逗号分隔）<input value={(draft.tags || []).join(", ")} onChange={(event) => update("tags", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
              </div>
              {([
                ["description", "角色描述"], ["personality", "性格"], ["scenario", "场景"], ["first_mes", "首条消息"],
                ["mes_example", "示例对话"], ["system_prompt", "角色 System Prompt"], ["post_history_instructions", "Post-History Instruction"], ["creator_notes", "作者备注"]
              ] as Array<[keyof Character, string]>).map(([field, label]) => <label key={field}>{label}<textarea value={String(draft[field] || "")} onChange={(event) => update(field, event.target.value)} /></label>)}
              <fieldset className="alternate-greetings"><legend>Alternate Greetings（将成为根级 swipes）</legend>
                {(draft.alternate_greetings || []).map((greeting, index) => <div key={index}><label className="form-field"><span>备选根级开场 {index + 2}</span><textarea value={greeting} onChange={(event) => update("alternate_greetings", draft.alternate_greetings.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /></label><button className="icon-button danger-button" title="删除这个备选开场" aria-label={`删除备选开场 ${index + 2}`} onClick={() => update("alternate_greetings", draft.alternate_greetings.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={15} /></button></div>)}
                <button className="secondary-button" onClick={() => update("alternate_greetings", [...(draft.alternate_greetings || []), ""])}><Plus size={15} />添加 greeting</button>
              </fieldset>
            </div>
            <footer><button className="primary-button" disabled={busy || !draft.name.trim()} onClick={save}><Save size={16} />保存本地角色</button></footer>
          </section>
        </div>
      )}
    </>
  );
}

function newEntry(worldbookId: string): WorldBookEntry {
  return { id: temporaryId("entry"), worldbook_id: worldbookId, keys: [], secondary_keys: [], content: "", enabled: true, constant: false, selective: false, order: 100, position: "after_char", uid: null, depth: null, case_sensitive: false, match_whole_words: false, raw_json: {} };
}

export function WorldbookManager({ worldbooks, onChanged, onError }: CommonProps & { worldbooks: WorldBook[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorldBook | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const selected = worldbooks.find((item) => item.id === editingId);
    setDraft(selected ? structuredClone(selected) : null);
  }, [editingId]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await api.updateWorldbook(draft.id, draft);
      onChanged();
      setEditingId(null);
    } catch (cause) {
      onError?.(cause instanceof Error ? cause.message : String(cause));
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

  function patchEntry(index: number, patch: Partial<WorldBookEntry>) {
    setDraft((current) => current ? { ...current, entries: current.entries.map((entry, entryIndex) => entryIndex === index ? { ...entry, ...patch } : entry) } : current);
  }

  return (
    <>
      <div className="resource-list">
        {worldbooks.map((book) => <div className="resource-row" key={book.id}><span className="book-badge">WB</span><span>{book.name} · {book.entries.length} 条</span><button className="icon-button" title="编辑世界书" onClick={() => setEditingId(book.id)}><Pencil size={15} /></button><button className="icon-button" title="导出世界书" onClick={() => api.exportWorldbook(book.id, `${book.name}.json`).catch((cause) => onError?.(cause instanceof Error ? cause.message : String(cause)))}><Download size={15} /></button><button className="icon-button danger-button" title="删除世界书" onClick={() => remove(book)}><Trash2 size={15} /></button></div>)}
      </div>
      {draft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setEditingId(null)}>
          <section className="resource-modal worldbook-modal" role="dialog" aria-modal="true" aria-label={`编辑世界书 ${draft.name}`}>
            <header><div><p className="eyebrow">World Book</p><h2>编辑世界书与条目</h2></div><button className="icon-button" title="关闭" onClick={() => setEditingId(null)}><X size={17} /></button></header>
            <div className="resource-modal-body">
              <div className="editor-grid"><label>名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /><small>在会话绑定列表中显示的名称。</small></label><label>扫描最近消息数<input type="number" min="0" value={draft.scan_depth} onChange={(event) => setDraft({ ...draft, scan_depth: Number(event.target.value) })} /><small>用最近多少条树路径消息查找触发关键词。</small></label><label>激活内容 Token 上限<input type="number" min="0" value={draft.token_budget} onChange={(event) => setDraft({ ...draft, token_budget: Number(event.target.value) })} /><small>本书一次最多插入 Prompt 的估算 Token 数。</small></label></div>
              <label>描述<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
              <div className="worldbook-entry-list">
                {draft.entries.map((entry, index) => (
                  <article className="worldbook-entry-card" key={entry.id || index}>
                    <header><strong>条目 {index + 1}</strong><button className={`icon-button config-toggle ${entry.enabled ? "active" : ""}`} aria-pressed={entry.enabled} aria-label={entry.enabled ? `停用条目 ${index + 1}` : `启用条目 ${index + 1}`} title={entry.enabled ? "已启用；点击停用" : "已停用；点击启用"} onClick={() => patchEntry(index, { enabled: !entry.enabled })}>{entry.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}</button><button className="icon-button danger-button" title="删除条目" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={15} /></button></header>
                    <label>主关键词（逗号分隔）<input value={entry.keys.join(", ")} onChange={(event) => patchEntry(index, { keys: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /><small>任一关键词命中时可激活此条目。</small></label>
                    <label>次关键词（逗号分隔）<input value={entry.secondary_keys.join(", ")} onChange={(event) => patchEntry(index, { secondary_keys: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /><small>开启“需次关键词”后，还必须命中这里的任一项。</small></label>
                    <label>内容<textarea value={entry.content} onChange={(event) => patchEntry(index, { content: event.target.value })} /></label>
                    <div className="entry-options"><label>插入顺序<input type="number" value={entry.order} onChange={(event) => patchEntry(index, { order: Number(event.target.value) })} /><small>数字较小的条目先插入。</small></label><label>插入位置<select value={entry.position} onChange={(event) => patchEntry(index, { position: event.target.value })}><option value="before_char">角色设定之前</option><option value="after_char">角色设定之后</option></select><small>决定它位于角色设定的前还是后。</small></label><label title="不检查关键词，每次都插入"><input type="checkbox" checked={entry.constant} onChange={(event) => patchEntry(index, { constant: event.target.checked })} />始终插入</label><label title="主关键词命中后还需要次关键词"><input type="checkbox" checked={entry.selective} onChange={(event) => patchEntry(index, { selective: event.target.checked })} />需次关键词</label><label><input type="checkbox" checked={entry.case_sensitive} onChange={(event) => patchEntry(index, { case_sensitive: event.target.checked })} />区分大小写</label><label><input type="checkbox" checked={entry.match_whole_words} onChange={(event) => patchEntry(index, { match_whole_words: event.target.checked })} />仅匹配完整词</label></div>
                  </article>
                ))}
              </div>
              <button className="secondary-button full-button" onClick={() => setDraft({ ...draft, entries: [...draft.entries, newEntry(draft.id)] })}><Plus size={15} />添加世界书条目</button>
            </div>
            <footer><button className="primary-button" disabled={busy || !draft.name.trim()} onClick={save}><Save size={16} />保存世界书</button></footer>
          </section>
        </div>
      )}
    </>
  );
}
