import { usePreviewSelection } from "../lib/usePreviewSelection";
import { createContext, memo, useContext, useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ttsDisplayText } from "../features/tts/displayText";
import { previewPlugin, type PreviewResolver } from "../lib/textPreview";
import { protectLegacyMacros } from "../lib/macros";
import { TextPreviewSpan } from "./TextPreviewSpan";

type Props = { content: string; previews?: PreviewResolver; showAllReplacements?: boolean };
type Controls = { toggled: ReadonlySet<string>; all: boolean; toggle: (id: string) => void };
const PreviewControls = createContext<Controls | null>(null);

// Stable component identities preserve focus when a preview changes its text.
const components: Components = {
  a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  span: function PreviewMarkdownSpan({ node, children, ...props }) {
    const controls = useContext(PreviewControls);
    const properties = node?.properties || {};
    const id = properties["data-preview-id"];
    if (typeof id !== "string" || !controls) return <span {...props}>{children}</span>;
    return <TextPreviewSpan original={String(properties["data-preview-original"] ?? "")}
      replacement={String(properties["data-preview-replacement"] ?? "")}
      first={properties["data-preview-first"] === "true"}
      replaced={controls.all !== controls.toggled.has(id)} onToggle={() => controls.toggle(id)}>{children}</TextPreviewSpan>;
  },
  code({ node, className, children, ...props }) {
    const isInline = !className;
    if (isInline) return <code className="inline-code" {...props}>{children}</code>;
    return <pre className="code-block"><code className={className} {...props}>{children}</code></pre>;
  },
};

export const MarkdownMessage = memo(function MarkdownMessage({ content, previews, showAllReplacements = false }: Props) {
  const selection = usePreviewSelection([content, previews, showAllReplacements]);
  const protectedContent = useMemo(() => protectLegacyMacros(ttsDisplayText(content)), [content]);
  const plugins = useMemo(() => [previewPlugin(previews ?? (() => []), protectedContent.restore)], [previews, protectedContent]);
  return <PreviewControls.Provider value={{ toggled: selection.ids, all: showAllReplacements, toggle: selection.toggle }}>
    <div className="message-content markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={plugins} components={components}>
        {protectedContent.text}
      </ReactMarkdown>
    </div>
  </PreviewControls.Provider>;
});
