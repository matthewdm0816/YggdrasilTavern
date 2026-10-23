import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../styles/text-preview.css";

export const TextPreviewCompactContext = createContext(false);

type Props = {
  children: ReactNode; original: string; replacement: string; first: boolean;
  replaced: boolean; onToggle: () => void;
};

export function TextPreviewSpan({ children, original, replacement, first, replaced, onToggle }: Props) {
  const compact = useContext(TextPreviewCompactContext);
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const tooltip = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  function keepOpen() { clearTimeout(closeTimer.current); }
  function scheduleClose() { clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setPosition(null), 120); }
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  function open() {
    keepOpen();
    if (compact || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(360, window.innerWidth - 16) - 8)),
      top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 170)) });
  }
  const isOpen = position !== null;
  useEffect(() => {
    if (!isOpen) return;
    const close = (event: Event) => { if (!(event.target instanceof Node) || !tooltip.current?.contains(event.target)) setPosition(null); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [isOpen]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  useEffect(() => setPosition(null), [compact, original, replacement]);
  return <>
    <span ref={anchor} className={replaced ? "text-preview replaced" : "text-preview"}
      role="button" tabIndex={replaced && !first ? -1 : 0} aria-hidden={replaced && !first || undefined} aria-pressed={replaced}
      aria-label={`${replaced ? "替换后" : "原文"}：${replaced ? replacement || "（空文本）" : original}；悬停或聚焦预览，Enter 或空格切换`}
      aria-describedby={position ? tooltipId : undefined}
      onMouseEnter={open} onMouseLeave={scheduleClose} onFocus={open} onBlur={scheduleClose}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (compact) onToggle(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onToggle(); }
        if (event.key === "Escape") { event.stopPropagation(); setPosition(null); }
      }}>
      {replaced ? (first ? replacement || <span className="text-preview-empty">（空文本）</span> : null) : children}
    </span>
    {position && createPortal(<span ref={tooltip} id={tooltipId} role="tooltip" tabIndex={0} onMouseEnter={keepOpen} onMouseLeave={scheduleClose} onFocus={keepOpen} onBlur={scheduleClose} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); anchor.current?.focus(); setPosition(null); } }} className="text-preview-tooltip" style={position}>
      {replacement || "（替换为空文本）"}
    </span>, document.body)}
  </>;
}
