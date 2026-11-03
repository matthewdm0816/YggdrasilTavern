import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { ActionMenu } from "./ActionMenu";

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Props = { note: string; children: ReactNode };

/** Usage stats stay inline while they fit; otherwise a small button opens them. */
export function MessageUsage({ note, children }: Props) {
  const row = useRef<HTMLElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Collapsed stats stay laid out but hidden, so a wider row can show them again.
  const measure = () => {
    const element = row.current;
    if (element) setCollapsed(element.scrollWidth > element.clientWidth);
  };
  useBrowserLayoutEffect(measure);
  useEffect(() => {
    if (!row.current) return;
    const observer = new ResizeObserver(measure);
    observer.observe(row.current);
    return () => observer.disconnect();
  }, []);

  return <small ref={row} className={`message-usage${collapsed ? " is-collapsed" : ""}`} title={note}>
    {children}
    {collapsed && <ActionMenu label="用量统计" icon={<Info size={17} />} className="message-usage-toggle">
      <div className="message-usage-details">{children}<p>{note}</p></div>
    </ActionMenu>}
  </small>;
}
