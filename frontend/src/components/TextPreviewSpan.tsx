import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../lib/useMediaQuery";
import "../styles/text-preview.css";

type Props = {
  children: ReactNode; original: string; replacement: string; first: boolean;
  replaced: boolean; onToggle: () => void;
};

export function TextPreviewSpan({ children, original, replacement, first, replaced, onToggle }: Props) {
  const compact = useMediaQuery("(max-width: 920px), (pointer: coarse), (hover: none)");
  const anchor = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  function open() {
    if (compact || !anchor.current) return;
    const rect = anchor.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.min(360, window.innerWidth - 16) - 8)),
      top: Math.min(rect.bottom + 6, Math.max(8, window.innerHeight - 170)) });
  }
  useEffect(() => {
    const close = () => setPosition(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, []);
  useEffect(() => setPosition(null), [compact, original, replacement]);
  return <>
    <span ref={anchor} className={replaced ? "text-preview replaced" : "text-preview"}
      role="button" tabIndex={0} aria-pressed={replaced}
      aria-label={`${replaced ? "替换后" : "原文"}：${replaced ? replacement || "（空文本）" : original}；悬停或聚焦预览，Enter 或空格切换`}
      aria-describedby={position ? tooltipId : undefined}
      onMouseEnter={open} onMouseLeave={() => setPosition(null)} onFocus={open} onBlur={() => setPosition(null)}
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (compact) onToggle(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onToggle(); }
        if (event.key === "Escape") { event.stopPropagation(); setPosition(null); }
      }}>
      {replaced ? (first ? replacement || <span className="text-preview-empty">（空文本）</span> : null) : children}
    </span>
    {position && createPortal(<span id={tooltipId} role="tooltip" className="text-preview-tooltip" style={position}>
      {replacement || "（替换为空文本）"}
    </span>, document.body)}
  </>;
}
