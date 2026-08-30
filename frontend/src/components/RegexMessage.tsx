import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Message, RegexRule } from "../lib/api";
import { transformMessageContent } from "../lib/regex";
import { MarkdownMessage } from "./MarkdownMessage";

type Props = {
  content: string;
  role: Message["role"];
  rules: RegexRule[];
};

export function RegexMessage({ content, role, rules }: Props) {
  const blocks = useMemo(() => transformMessageContent(content, role, rules), [content, role, rules]);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => setRevealed(new Set()), [content, rules]);

  function toggle(id: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="regex-message">
      {blocks.map((block) => {
        if (!block.veiled) return block.text.trim() ? <MarkdownMessage key={block.id} content={block.text} /> : <span key={block.id}>{block.text}</span>;
        const isRevealed = revealed.has(block.id);
        return (
          <div
            key={block.id}
            className={isRevealed ? "veil-block revealed" : "veil-block"}
            role="button"
            tabIndex={0}
            aria-pressed={isRevealed}
            onClick={() => toggle(block.id)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle(block.id);
              }
            }}
          >
            <span className="veil-label">
              {isRevealed ? <Eye size={15} /> : <EyeOff size={15} />}
              {isRevealed ? "点击重新遮罩" : `Regex 隐式替换 · ${block.ruleNames.join("、") || "命中"}`}
            </span>
            <div className="veil-content"><MarkdownMessage content={block.text} /></div>
          </div>
        );
      })}
    </div>
  );
}
