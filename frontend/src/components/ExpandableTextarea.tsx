import { Maximize2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minHeight?: number;
  placeholder?: string;
  expandedActions?: ReactNode;
  expandedFeedback?: ReactNode;
  closeLabel?: string;
};

/**
 * A labelled multi-line field with a comfortable default height and a button
 * that opens the same value in a near-full-screen editor.
 */
export function ExpandableTextarea({ label, value, onChange, minHeight = 200, placeholder, expandedActions, expandedFeedback, closeLabel = "完成" }: Props) {
  const [expanded, setExpanded] = useState(false);
  const fieldId = useId();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const overlay = overlayRef.current;
    if (!overlay) return;
    const field = fieldRef.current;
    const background = document.getElementById("root");
    const wasInert = background?.inert || false;
    if (background) background.inert = true;
    overlay.focus();
    overlay.setSelectionRange(overlay.value.length, overlay.value.length);

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const controls = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']"
        ) || []).filter((item) => item.getClientRects().length > 0);
        const first = controls[0], last = controls[controls.length - 1];
        const focusOutside = !panelRef.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || focusOutside)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || focusOutside)) {
          event.preventDefault();
          first?.focus();
        }
        event.stopPropagation();
        return;
      }
      if (event.key !== "Escape") return;
      // Capture phase: keep the app-level Escape handling (mobile drawers) out of it.
      event.preventDefault();
      event.stopPropagation();
      setExpanded(false);
    }

    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("keydown", closeOnEscape, true);
      if (background) background.inert = wasInert;
      if (field?.isConnected) field.focus({ preventScroll: true });
    };
  }, [expanded]);

  function close() {
    setExpanded(false);
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
          <section ref={panelRef} className="textarea-overlay-panel" role="dialog" aria-modal="true" aria-label={`放大编辑：${label}`}>
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
              aria-label={label}
              value={value}
              placeholder={placeholder}
              onChange={(event) => onChange(event.target.value)}
            />
            <footer className={expandedActions || expandedFeedback ? "textarea-overlay-footer-with-actions" : undefined}>
              {expandedActions || expandedFeedback ? <>
                <div className="textarea-overlay-footer-details">
                  <span>{value.length.toLocaleString("zh-CN")} 个字符 · 按 Esc 关闭</span>
                  {expandedFeedback}
                </div>
                <div className="textarea-overlay-footer-actions">
                  {expandedActions}
                  <button type="button" className="secondary-button" onClick={close}>{closeLabel}</button>
                </div>
              </> : <>
                <span>{value.length.toLocaleString("zh-CN")} 个字符 · 按 Esc 关闭</span>
                <button type="button" className="primary-button" onClick={close}>{closeLabel}</button>
              </>}
            </footer>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
