import { Maximize2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
  placeholder?: string;
};

/**
 * A labelled multi-line field with a comfortable default height and a button
 * that opens the same value in a near-full-screen editor.
 */
export function ExpandableTextarea({ label, value, onChange, minHeight = 200, placeholder }: Props) {
  const [expanded, setExpanded] = useState(false);
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    overlay.focus();
    overlay.setSelectionRange(overlay.value.length, overlay.value.length);

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Capture phase: keep the app-level Escape handling (mobile drawers) out of it.
      event.stopPropagation();
      setExpanded(false);
      fieldRef.current?.focus();
    }

    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [expanded]);

  function close() {
    setExpanded(false);
    fieldRef.current?.focus();
  }

  return (
    <div className="expandable-field">
      <div className="expandable-field-header">
        <label className="expandable-field-label" htmlFor={fieldId}>{label}</label>
        <button
          type="button"
          className="field-expand-button"
          title={`放大编辑${label}`}
          aria-label={`放大编辑${label}`}
          onClick={() => setExpanded(true)}
        >
          <Maximize2 size={13} />
          放大编辑
        </button>
      </div>
      <textarea
        id={fieldId}
        ref={fieldRef}
        className="expandable-field-input"
        style={{ minHeight }}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {expanded && createPortal(
        <div
          className="textarea-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section className="textarea-overlay-panel" role="dialog" aria-modal="true" aria-label={`放大编辑：${label}`}>
            <header>
              <div>
                <p className="eyebrow">放大编辑</p>
                <h2>{label}</h2>
              </div>
              <button type="button" className="icon-button" title="关闭放大编辑" aria-label="关闭放大编辑" onClick={close}>
                <X size={17} />
              </button>
            </header>
            <textarea
              ref={overlayRef}
              className="textarea-overlay-input"
              value={value}
              placeholder={placeholder}
              onChange={(event) => onChange(event.target.value)}
            />
            <footer>
              <span>{value.length.toLocaleString("zh-CN")} 个字符 · 按 Esc 关闭</span>
              <button type="button" className="primary-button" onClick={close}>完成</button>
            </footer>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
