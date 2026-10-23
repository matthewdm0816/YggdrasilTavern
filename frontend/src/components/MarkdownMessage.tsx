import { memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ttsDisplayText } from "../features/tts/displayText";
import { previewPlugin, type PreviewResolver } from "../lib/textPreview";
import { TextPreviewSpan } from "./TextPreviewSpan";

type Props = { content: string; previews?: PreviewResolver; showAllReplacements?: boolean };

export const MarkdownMessage = memo(function MarkdownMessage({ content, previews, showAllReplacements = false }: Props) {
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const plugins = useMemo(() => previews ? [previewPlugin(previews)] : [], [previews]);
  useEffect(() => setToggled(new Set()), [content, previews, showAllReplacements]);
  function toggle(id: string) {
    setToggled((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  return (
    <div className="message-content markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={plugins}
        components={{
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          span: ({ node, children, ...props }) => {
            const properties = node?.properties || {};
            const id = properties["data-preview-id"];
            if (typeof id !== "string") return <span {...props}>{children}</span>;
            return <TextPreviewSpan original={String(properties["data-preview-original"] ?? "")}
              replacement={String(properties["data-preview-replacement"] ?? "")}
              first={properties["data-preview-first"] === "true"}
              replaced={showAllReplacements !== toggled.has(id)} onToggle={() => toggle(id)}>{children}</TextPreviewSpan>;
          },
          code({ node, className, children, ...props }) {
            const isInline = !className;
            if (isInline) return <code className="inline-code" {...props}>{children}</code>;
            return <pre className="code-block"><code className={className} {...props}>{children}</code></pre>;
          },
        }}>
        {ttsDisplayText(content)}
      </ReactMarkdown>
    </div>
  );
});
