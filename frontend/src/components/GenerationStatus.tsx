import { useEffect, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, Square, X } from "lucide-react";
import type { ActiveGeneration } from "../features/chat/GenerationRegistry";
import type { UnreadGeneration } from "../features/chat/useChatController";
import "../styles/generation-status.css";

type Props = {
  active: ActiveGeneration[];
  unread: UnreadGeneration[];
  sessionTitles: Record<string, string>;
  currentSessionId: string;
  onStop: (key: string) => void;
  onOpen: (sessionId: string, messageId: string) => void;
  onDismiss: (messageId: string) => void;
};

const finishedLabels: Record<string, string> = { complete: "已完成", failed: "失败", interrupted: "已中断", cancelled: "已取消" };

/** Header tag for replies that are streaming or finished out of sight; tapping it lists them. */
export function GenerationStatus({ active, unread, sessionTitles, currentSessionId, onStop, onOpen, onDismiss }: Props) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const empty = active.length === 0 && unread.length === 0;

  useEffect(() => { if (empty) setExpanded(false); }, [empty]);
  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setExpanded(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded]);

  if (empty) return null;
  const where = (sessionId: string) => sessionId === currentSessionId ? "本会话" : sessionTitles[sessionId] || "其他会话";
  const open = (sessionId: string, messageId: string) => {
    setExpanded(false);
    onOpen(sessionId, messageId);
  };

  return (
    <div className="generation-status" ref={rootRef}>
      <button type="button" className="generation-status-chip" aria-expanded={expanded}
        aria-label={`生成状态：${active.length} 个生成中，${unread.length} 个未读`} title="生成状态"
        onClick={() => setExpanded((value) => !value)}>
        {active.length > 0 && <span className="generation-status-count"><LoaderCircle size={14} className="generation-status-spinner" />{active.length}</span>}
        {unread.length > 0 && <span className="generation-status-count unread"><span className="generation-status-dot" />{unread.length}</span>}
      </button>
      {expanded && (
        <div className="generation-status-panel" role="region" aria-label="生成状态">
          <ul>
            {active.map((item) => (
              <li key={item.key} className="generation-status-row">
                <button type="button" className="generation-status-open" disabled={!item.messageId}
                  onClick={() => item.messageId && open(item.sessionId, item.messageId)}>
                  <LoaderCircle size={14} className="generation-status-spinner" />
                  <span className="generation-status-text">
                    <strong>生成中 · {where(item.sessionId)}</strong>
                    <span>{item.parentId === null ? "从开头生成" : item.label ? `接着“${item.label}”` : "接着一条空消息"}</span>
                  </span>
                </button>
                <button type="button" className="secondary-button" onClick={() => onStop(item.key)}><Square size={12} />停止</button>
              </li>
            ))}
            {unread.map((item) => (
              <li key={item.messageId} className="generation-status-row">
                <button type="button" className="generation-status-open" onClick={() => open(item.sessionId, item.messageId)}>
                  {item.status === "complete" ? <span className="generation-status-dot" /> : <AlertCircle size={14} className="generation-status-alert" />}
                  <span className="generation-status-text">
                    <strong>{finishedLabels[item.status] || item.status} · {where(item.sessionId)}</strong>
                    <span>{item.label ? `“${item.label}”` : "（空回复）"}</span>
                  </span>
                </button>
                <button type="button" className="icon-button" aria-label="标为已读" title="标为已读" onClick={() => onDismiss(item.messageId)}><X size={14} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
