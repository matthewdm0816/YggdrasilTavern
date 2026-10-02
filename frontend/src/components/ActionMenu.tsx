import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Props = { label: string; children: ReactNode; className?: string };

/** A disclosure with normal buttons and form controls; Tab retains its usual behavior. */
export function ActionMenu({ label, children, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();

  useBrowserLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = panel.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8)),
      top: anchor.bottom + bounds.height + 8 <= window.innerHeight
        ? anchor.bottom + 6
        : Math.max(8, anchor.top - bounds.height - 6)
    });
    panel.current.querySelector<HTMLElement>("button:not(:disabled), select, input")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const menuPanel = panel.current;
    const outside = (event: PointerEvent) => {
      if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || (!menuPanel?.contains(event.target as Node) && event.target !== trigger.current)) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return <>
    <button ref={trigger} className={`icon-button ${className}`} type="button" title={label} aria-label={label}
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((value) => !value)}>
      <MoreHorizontal size={19} />
    </button>
    {open && createPortal(<div ref={panel} id={id} className="action-menu" aria-label={label} style={position}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) setOpen(false); }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button[data-close-menu]")) {
          setOpen(false);
          trigger.current?.focus();
        }
      }}>{children}</div>, document.body)}
  </>;
}
