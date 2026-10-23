import { useState } from "react";

const empty = new Set<string>();
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/** Reset derived preview state during render, so whole-message toggles never flash stale selections. */
export function usePreviewSelection(identity: readonly unknown[]) {
  const [selection, setSelection] = useState<{ identity: readonly unknown[]; ids: Set<string> }>({ identity, ids: empty });
  const ids = same(selection.identity, identity) ? selection.ids : empty;
  function toggle(id: string) {
    setSelection((current) => {
      const next = new Set(same(current.identity, identity) ? current.ids : empty);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { identity, ids: next };
    });
  }
  return { ids, toggle };
}
