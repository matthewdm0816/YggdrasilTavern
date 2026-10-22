import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle, Save, Volume2, X } from "lucide-react";
import { ttsApi, ttsSettingsQueryKey, type TtsSettings, type TtsVoice } from "./api";
import "../../styles/model-settings.css";
import "./tts.css";

type Props = { open: boolean; onClose: () => void };
type Draft = Omit<TtsSettings, "has_api_key" | "revision"> & { api_key: string; clear_api_key: boolean };
function draftFrom(settings: TtsSettings): Draft {
  const { has_api_key: _key, revision: _revision, ...fields } = settings;
  return { ...fields, api_key: "", clear_api_key: false };
}

export function TtsSettingsDialog({ open, onClose }: Props) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ttsSettingsQueryKey, queryFn: ({ signal }) => ttsApi.settings(signal) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [baseline, setBaseline] = useState<TtsSettings | null>(null);
  const draftRef = useRef(draft), baselineRef = useRef(baseline);
  draftRef.current = draft; baselineRef.current = baseline;
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [reloading, setReloading] = useState(false);
  const mountedRef = useRef(true);
  const voiceRequestRef = useRef<{ controller: AbortController; revision: number } | null>(null);
  const reloadControllerRef = useRef<AbortController | null>(null);
  const cancelVoices = useCallback(() => {
    voiceRequestRef.current?.controller.abort();
    voiceRequestRef.current = null;
    setLoadingVoices(false);
    setVoices([]);
  }, []);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const dirty = Boolean(draft && baseline && JSON.stringify(draft) !== JSON.stringify(draftFrom(baseline)));
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      voiceRequestRef.current?.controller.abort();
      voiceRequestRef.current = null;
      reloadControllerRef.current?.abort();
      reloadControllerRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (!open) cancelVoices();
  }, [open, cancelVoices]);
  useEffect(() => {
    if (!query.data) return;
    const old = baselineRef.current, current = draftRef.current;
    if (old?.revision !== query.data.revision) cancelVoices();
    if (old && current && JSON.stringify(current) !== JSON.stringify(draftFrom(old))) return;
    setBaseline(query.data); setDraft(draftFrom(query.data));
  }, [query.data, cancelVoices]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      focusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!open && dialog.open) { dialog.close(); focusRef.current?.focus(); }
  }, [open]);
  const patch = (value: Partial<Draft>) => {
    const current = draftRef.current;
    if ((value.provider !== undefined && value.provider !== current?.provider)
      || (value.endpoint !== undefined && value.endpoint !== current?.endpoint)) cancelVoices();
    setDraft(current => current ? { ...current, ...value } : current);
    setNotice("");
  };
  async function save() {
    if (!draft || !baseline || !dirty || savingRef.current || reloadControllerRef.current) return;
    cancelVoices();
    savingRef.current = true; setSaving(true); setError(null);
    try {
      const { api_key, ...fields } = draft;
      const saved = await ttsApi.saveSettings({ ...fields, ...(api_key.trim() ? { api_key: api_key.trim() } : {}), expected_revision: baseline.revision });
      setBaseline(saved); setDraft(draftFrom(saved)); client.setQueryData(ttsSettingsQueryKey, saved);
      setVoices([]); setNotice("语音设置已保存。");
      await client.invalidateQueries({ queryKey: ["context-preview"] });
    } catch (cause) { setError("语音设置保存失败：" + (cause instanceof Error ? cause.message : String(cause))); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function reloadSettings() {
    if (savingRef.current || reloadControllerRef.current) return;
    cancelVoices();
    const controller = new AbortController();
    reloadControllerRef.current = controller;
    setReloading(true); setError(null); setNotice("");
    try {
      await client.cancelQueries({ queryKey: ttsSettingsQueryKey, exact: true });
      const fresh = await ttsApi.settings(controller.signal);
      if (!mountedRef.current || controller.signal.aborted || reloadControllerRef.current !== controller) return;
      baselineRef.current = fresh;
      draftRef.current = draftFrom(fresh);
      setBaseline(fresh); setDraft(draftRef.current); client.setQueryData(ttsSettingsQueryKey, fresh);
      setNotice("已重新加载服务器上的语音设置，未保存的草稿已放弃。");
    } catch (cause) {
      if (mountedRef.current && !controller.signal.aborted) setError("重新加载语音设置失败：" + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      if (reloadControllerRef.current === controller) {
        reloadControllerRef.current = null;
        if (mountedRef.current) setReloading(false);
      }
    }
  }
  async function loadVoices() {
    const saved = baselineRef.current;
    if (!saved || dirty || voiceRequestRef.current || savingRef.current || reloadControllerRef.current) return;
    const pending = { controller: new AbortController(), revision: saved.revision };
    voiceRequestRef.current = pending;
    const isCurrent = () => mountedRef.current && voiceRequestRef.current === pending
      && !pending.controller.signal.aborted && baselineRef.current?.revision === pending.revision
      && client.getQueryData<TtsSettings>(ttsSettingsQueryKey)?.revision === pending.revision
      && draftRef.current?.provider === saved.provider && draftRef.current?.endpoint === saved.endpoint;
    setLoadingVoices(true); setError(null);
    try {
      const result = await ttsApi.voices(pending.controller.signal);
      if (!isCurrent()) return;
      setVoices(result.voices);
      setNotice(result.voices.length ? "已获取 " + result.voices.length + " 个音色，可在音色输入框中选择。" : "服务商没有返回可用音色；可手动填写音色 ID。");
    } catch (cause) {
      if (isCurrent()) setError("获取音色失败：" + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      if (voiceRequestRef.current === pending) {
        voiceRequestRef.current = null;
        if (mountedRef.current) setLoadingVoices(false);
      }
    }
  }
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialogRef} className="model-settings-dialog tts-settings-dialog" aria-labelledby="tts-settings-title"
    onCancel={event => { event.preventDefault(); if (!saving && !reloading) onClose(); }}>
    <header className="model-settings-header">
      <div><h2 id="tts-settings-title"><Volume2 size={18} />语音朗读（试验）</h2><p>当前账号的所有会话共用；默认手动触发。</p></div>
      <button type="button" className="icon-button" aria-label="关闭语音设置" disabled={saving || reloading} onClick={onClose}><X size={18} /></button>
    </header>
    <div className="tts-save-bar">
      <button type="button" className={dirty ? "primary-button" : "secondary-button"} disabled={!dirty || saving || reloading || query.isPending} onClick={() => void save()}>
        {saving ? <LoaderCircle size={16} className="model-loading-spinner" /> : <Save size={16} />}{saving ? "保存中…" : "保存语音设置"}
      </button>
      <button type="button" className="secondary-button" disabled={saving || reloading} onClick={() => void reloadSettings()}>
        {reloading && <LoaderCircle size={16} className="model-loading-spinner" />}{reloading ? "重新加载中…" : "重新加载（放弃草稿）"}
      </button>
      <span role="status" aria-live="polite">{saving ? "正在保存…" : reloading ? "正在重新加载…" : dirty ? "有未保存修改。" : notice || "语音设置未修改。"}</span>
    </div>
    <div className="model-settings-content">
      {query.isPending && <p role="status">正在读取语音设置…</p>}
      {query.error && <p className="field-error" role="alert">读取语音设置失败：{query.error instanceof Error ? query.error.message : String(query.error)}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {draft && <fieldset disabled={saving || reloading} className="tts-fields">
        <label className="tts-checkbox"><input type="checkbox" checked={draft.enabled} onChange={e => patch({ enabled: e.target.checked })} /><span>启用语音朗读</span></label>
        <div className="tts-field-pair">
          <label className="form-field"><span>朗读文本来源</span><select value={draft.text_mode} onChange={e => patch({ text_mode: e.target.value as Draft["text_mode"] })}>
            <option value="dialogue">自动提取引号内的人物发言</option><option value="tags">只读 &lt;tts&gt;…&lt;/tts&gt; 标签内容</option>
          </select></label>
          <label className="form-field"><span>触发方式</span><select value={draft.trigger_mode} onChange={e => patch({ trigger_mode: e.target.value as Draft["trigger_mode"] })}>
            <option value="manual">手动（默认）</option><option value="auto">新回复完成后自动朗读</option>
          </select></label>
        </div>
        <p className="section-help">{draft.text_mode === "dialogue" ? "识别中英文和日文引号，跳过动作、代码和思考内容。没有匹配时不朗读旁白；手动朗读可先检查、调整文本。" : "只朗读完整的 <tts>...</tts> 内容；标签外的文字不朗读。正文显示时隐藏标签，编辑消息时保留原文。"}</p>
        {draft.text_mode === "tags" && <label className="tts-checkbox"><input type="checkbox" checked={draft.instruct_model} onChange={e => patch({ instruct_model: e.target.checked })} /><span>生成回复时，自动提示模型为人物发言添加 &lt;tts&gt; 标签</span></label>}
        {draft.trigger_mode === "auto" && <p className="section-help">仅朗读当前会话中新生成完成的角色回复。打开旧会话或切换 swipe 不会触发；浏览器可能要求先点击一次播放。</p>}
        <hr />
        <label className="form-field"><span>TTS 服务接口类型</span><select value={draft.provider} onChange={e => patch(e.target.value === "minimax"
          ? { provider: "minimax", endpoint: "https://api.minimax.cn/v1/t2a_v2", model: "speech-2.8-hd", voice: "", api_key: "" }
          : { provider: "openai_compatible", endpoint: "", model: "", voice: "", api_key: "" })}>
          <option value="minimax">MiniMax 原生语音接口</option><option value="openai_compatible">OpenAI 兼容语音接口</option>
        </select></label>
        <label className="form-field"><span>完整语音接口地址</span><input value={draft.endpoint} placeholder={draft.provider === "minimax" ? "https://api.minimax.cn/v1/t2a_v2" : "https://服务地址/v1/audio/speech"} onChange={e => patch({ endpoint: e.target.value })} />
          <small>{draft.provider === "minimax" ? "国内：https://api.minimax.cn/v1/t2a_v2；国际：https://api.minimax.io/v1/t2a_v2。按 API Key 所属平台填写。" : "填写返回音频的完整地址，通常以 /v1/audio/speech 结尾。"}更换接口或供应商后，需重新填写 API Key 或明确清除原 Key。</small>
        </label>
        <label className="form-field"><span>API Key</span><input type="password" autoComplete="off" value={draft.api_key} placeholder={baseline?.has_api_key ? "已保存；留空保留原 Key" : "填写 API Key（本地无鉴权服务可留空）"} onChange={e => patch({ api_key: e.target.value, clear_api_key: false })} /><small>密钥保存在当前账号的服务器数据中，不回传到浏览器。</small></label>
        {baseline?.has_api_key && <label className="tts-checkbox"><input type="checkbox" checked={draft.clear_api_key} onChange={e => patch({ clear_api_key: e.target.checked, api_key: "" })} /><span>清除已保存的 API Key</span></label>}
        <div className="tts-field-pair">
          <label className="form-field"><span>语音模型</span><input list="tts-model-options" value={draft.model} onChange={e => patch({ model: e.target.value })} /><datalist id="tts-model-options">{(draft.provider === "minimax" ? ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo"] : []).map(name => <option key={name} value={name} />)}</datalist></label>
          <label className="form-field"><span>音色 ID</span><input list="tts-voice-options" value={draft.voice} placeholder="选择或填写音色 ID" onChange={e => patch({ voice: e.target.value })} /><datalist id="tts-voice-options">{voices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</datalist></label>
        </div>
        {draft.provider === "minimax" && <div className="tts-voice-actions"><button type="button" className="secondary-button" disabled={dirty || loadingVoices || !baseline?.has_api_key} onClick={() => void loadVoices()}>
          {loadingVoices ? <LoaderCircle size={15} className="model-loading-spinner" /> : <Download size={15} />}{loadingVoices ? "正在获取音色…" : "获取 MiniMax 音色"}
        </button><small>首次配置可先保持“启用语音朗读”关闭，保存连接后获取音色，选好音色再启用并保存；也可直接填写已有音色 ID。</small></div>}
        <div className="tts-field-pair">
          <label className="form-field"><span>语速</span><input type="number" min={draft.provider === "minimax" ? "0.5" : "0.25"} max={draft.provider === "minimax" ? "2" : "4"} step="0.1" value={draft.speed} onChange={e => patch({ speed: Number(e.target.value) })} /></label>
          {draft.provider === "minimax" && <label className="form-field"><span>音调</span><input type="number" min="-12" max="12" step="1" value={draft.pitch} onChange={e => patch({ pitch: Number(e.target.value) })} /></label>}
        </div>
        {draft.provider === "minimax" && <div className="tts-field-pair">
          <label className="form-field"><span>合成音量</span><input type="number" min="0.1" max="10" step="0.1" value={draft.volume} onChange={e => patch({ volume: Number(e.target.value) })} /></label>
          <label className="form-field"><span>情绪</span><select value={draft.emotion} onChange={e => patch({ emotion: e.target.value })}>
            <option value="">自动</option><option value="happy">开心</option><option value="sad">悲伤</option><option value="angry">愤怒</option><option value="fearful">恐惧</option><option value="disgusted">厌恶</option><option value="surprised">惊讶</option><option value="calm">平静</option><option value="fluent">流畅（模型需支持）</option><option value="whisper">低语（模型需支持）</option>
          </select></label>
          <label className="form-field"><span>语种增强</span><input list="tts-language-options" value={draft.language_boost} onChange={e => patch({ language_boost: e.target.value })} /><datalist id="tts-language-options">{["auto", "Chinese", "Chinese,Yue", "Japanese", "English"].map(name => <option key={name} value={name} />)}</datalist></label>
        </div>}
      </fieldset>}
    </div>
  </dialog>, document.body);
}
