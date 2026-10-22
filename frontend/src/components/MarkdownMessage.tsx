import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { ttsDisplayText } from "../features/tts/displayText";

type Props = {
  content: string;
};

export function MarkdownMessage({ content }: Props) {
  return (
    <div className="message-content markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          // Open links in new tab
          a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
          // Render code blocks with language class
          code({ node, className, children, ...props }) {
            const isInline = !className;
            if (isInline) {
              return <code className="inline-code" {...props}>{children}</code>;
            }
            return (
              <pre className="code-block">
                <code className={className} {...props}>{children}</code>
              </pre>
            );
          },
        }}
      >
        {ttsDisplayText(content)}
      </ReactMarkdown>
    </div>
  );
}
