import { LoaderCircle, Play, Square, Volume2, X } from "lucide-react";
import type { useTtsPlayback } from "./useTtsPlayback";
import "./tts.css";

export function TtsPlaybackBar({ playback }: { playback: ReturnType<typeof useTtsPlayback> }) {
  const { state, stop, resume, clearError } = playback;
  if (state.phase === "idle" && !state.error) return null;
  const active = state.phase === "loading" || state.phase === "playing" || state.phase === "blocked";
  return <div className="tts-playback-bar" role="status" aria-live="polite">
    {state.phase === "loading" ? <LoaderCircle size={16} className="model-loading-spinner" /> : <Volume2 size={16} />}
    <span>{state.phase === "loading" ? "正在合成语音…" : state.phase === "playing" ? "正在朗读…" : state.phase === "blocked" ? "音频已就绪，点击播放。" : "语音朗读失败。"}{state.queuedCount > 0 ? " 等待播放：" + state.queuedCount : ""}</span>
    {state.phase === "blocked" && <button className="secondary-button" type="button" onClick={() => void resume()}><Play size={14} />播放已生成音频</button>}
    {active && <button className="secondary-button" type="button" onClick={stop}><Square size={14} />停止朗读</button>}
    {state.error && <>
      <p className="field-error" role="alert">{state.error}</p>
      {state.phase !== "blocked" && <button className="icon-button" type="button" aria-label="关闭语音错误" onClick={clearError}><X size={15} /></button>}
    </>}
  </div>;
}
