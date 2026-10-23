import { usePreviewSelection } from "../lib/usePreviewSelection";
import { useMacroDisplayMode } from "../features/chat/macroDisplay";
import { displayMessageText, macroPreviews } from "../lib/macros";
import { useMessageMacroContext } from "./MessageMacroProvider";
import { TextPreviewSpan } from "./TextPreviewSpan";

/** A plain-text consumer, used where Markdown rendering would change existing presentation. */
export function MacroText({ content, showAllReplacements = false }: { content: string; showAllReplacements?: boolean }) {
  const context = useMessageMacroContext();
  const display = useMacroDisplayMode();
  const selection = usePreviewSelection([content, context, showAllReplacements, display.mode]);
  if (display.mode === "expanded") return <>{displayMessageText(content, context)}</>;
  const previews = macroPreviews(content, context);
  let cursor = 0;
  const result = previews.map((preview) => {
    const prefix = content.slice(cursor, preview.start);
    cursor = preview.end;
    return <span key={preview.id}>{prefix}<TextPreviewSpan original={preview.original}
      replacement={preview.replacement} first replaced={showAllReplacements !== selection.ids.has(preview.id)}
      onToggle={() => selection.toggle(preview.id)}>{preview.original}</TextPreviewSpan></span>;
  });
  return <>{result}{content.slice(cursor)}</>;
}
