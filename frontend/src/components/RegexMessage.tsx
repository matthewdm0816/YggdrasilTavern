import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Message, RegexRule } from "../lib/api";
import { DisplayBlock, transformMessageContent } from "../lib/regex";
import { MarkdownMessage } from "./MarkdownMessage";

type Props = {
  content: string;
  role: Message["role"];
  rules: RegexRule[];
};

type RenderGroup =
  | { kind: "markdown"; id: string; text: string }
  | { kind: "veil"; block: DisplayBlock };

// Consecutive plain blocks are rendered by one MarkdownMessage so that paragraph
// and list spacing stays markdown-normal instead of stacking a margin per block.
function groupBlocks(blocks: DisplayBlock[]): RenderGroup[] {
  const groups: RenderGroup[] = [];
  for (const block of blocks) {
    if (block.veiled) {
      groups.push({ kind: "veil", block });
      continue;
    }
    const last = groups[groups.length - 1];
    if (last?.kind === "markdown") last.text += block.text;
    else groups.push({ kind: "markdown", id: block.id, text: block.text });
  }
  return groups;
}

export function RegexMessage({ content, role, rules }: Props) {
  const blocks = useMemo(() => transformMessageContent(content, role, rules), [content, role, rules]);
  const groups = useMemo(() => groupBlocks(blocks), [blocks]);
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
      {groups.map((group) => {
        if (group.kind === "markdown") {
          return group.text.trim()
            ? <MarkdownMessage key={group.id} content={group.text} />
            : <span key={group.id}>{group.text}</span>;
        }
        const block = group.block;
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
