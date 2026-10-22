import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, Play, X } from "lucide-react";
import type { Message } from "../../lib/api";
import { ttsApi, type TtsPreview, type TtsSettings } from "./api";
import { TtsPlaybackBar } from "./TtsPlaybackBar";
import type { useTtsPlayback } from "./useTtsPlayback";
import "./tts.css";

type Props = {
  message: Message;
  settings?: TtsSettings;
  playback: ReturnType<typeof useTtsPlayback>;
  onClose: () => void;
  onSettings: () => void;
};

export function TtsMessageDialog({ message, settings, playback, onClose, onSettings }: Props) {
  const [preview, setPreview] = useState<TtsPreview | null>(null);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
    return () => { dialogRef.current?.close(); previous?.focus(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setPreview(null); setText("");
    void ttsApi.preview(message.id, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setPreview(result); setText(result.text);
    }).catch(cause => {
      if (!controller.signal.aborted) setError("提取朗读文本失败：" + (cause instanceof Error ? cause.message : String(cause)));
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [message.id, message.content, settings?.revision]);
  const length = Array.from(text).length;
  const tooLong = Boolean(preview && length > preview.max_characters);
  const currentLoading = playback.state.phase === "loading";
  if (typeof document === "undefined") return null;
  return createPortal(<dialog ref={dialogRef} className="model-settings-dialog tts-preview-dialog" aria-labelledby="tts-preview-title"
    onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className="model-settings-header">
      <div><h2 id="tts-preview-title">朗读这条消息</h2><p>先检查文本，再发送给语音服务；这里的编辑只影响本次朗读。</p></div>
      <button type="button" className="icon-button" aria-label="关闭朗读预览" onClick={onClose}><X size={18} /></button>
    </header>
    <div className="model-settings-content">
      {loading && <p className="model-progress" role="status"><LoaderCircle size={16} className="model-loading-spinner" />正在提取人物发言…</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {preview?.warnings.map((warning,index) => <p className="tts-preview-note" key={index}>{warning}</p>)}
      {!loading && !error && <>
        <label className="form-field"><span>本次朗读文本</span><textarea value={text} onChange={e => setText(e.target.value)} /></label>
        <p className={tooLong ? "field-error" : "tts-preview-note"} role="status">{length} / {preview?.max_characters ?? 0} 字符{tooLong ? "；请缩短后再朗读。" : ""}</p>
      </>}
      {!settings?.enabled && <p className="tts-preview-note">语音朗读尚未启用，请先配置接口、音色并启用。</p>}
      <div className="tts-preview-actions">
        <button type="button" className="primary-button" disabled={loading || Boolean(error) || !settings?.enabled || !text.trim() || tooLong || currentLoading}
          onClick={() => void playback.play(message, text)}><Play size={16} />{currentLoading ? "正在合成…" : "合成并播放"}</button>
        <button type="button" className="secondary-button" onClick={onSettings}>语音设置</button>
      </div>
      <TtsPlaybackBar playback={playback} />
    </div>
  </dialog>, document.body);
}
