import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

type Props = {
  contentId: string;
  title: string;
  icon: ReactNode;
  storageKey: string;
  defaultExpanded?: boolean;
  className?: string;
  headerMeta?: ReactNode;
  children: ReactNode;
};

function readPersistedState(storageKey: string, defaultExpanded: boolean) {
  if (typeof window === "undefined") return defaultExpanded;

  try {
    const storedValue = window.localStorage.getItem(storageKey);
    if (storedValue === null) return defaultExpanded;
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;

    console.error(
      `Invalid collapsible section state for localStorage key "${storageKey}":`,
      storedValue
    );
  } catch (error) {
    console.error(
      `Failed to read collapsible section state from localStorage key "${storageKey}":`,
      error
    );
  }

  return defaultExpanded;
}

export function CollapsibleSection({
  contentId,
  title,
  icon,
  storageKey,
  defaultExpanded = false,
  className = "tool-section",
  headerMeta,
  children
}: Props) {
  const [expanded, setExpanded] = useState(() => readPersistedState(storageKey, defaultExpanded));

  function toggleExpanded() {
    setExpanded((current) => {
      const next = !current;

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(storageKey, String(next));
        } catch (error) {
          console.error(
            `Failed to save collapsible section state to localStorage key "${storageKey}":`,
            error
          );
        }
      }

      return next;
    });
  }

  return (
    <section className={className} data-collapsed={!expanded}>
      <button
        type="button"
        className="section-title collapsible-section-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={toggleExpanded}
      >
        {icon}
        <span className="collapsible-section-title">{title}</span>
        {headerMeta && <span className="collapsible-section-meta">{headerMeta}</span>}
        <span className="collapsible-section-chevron" aria-hidden="true">
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>
      <div className="collapsible-section-content" id={contentId} hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
