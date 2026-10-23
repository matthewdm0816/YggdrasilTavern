import type { UseQueryResult } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import type { ContextPreview, WorldBook } from "../lib/api";
import { CollapsibleSection } from "./CollapsibleSection";

type Props = {
  selectedSessionId: string | null;
  previewQuery: UseQueryResult<ContextPreview, Error>;
  worldbooks?: WorldBook[];
};

export function ActivatedLoreList({ entries, worldbooks = [] }: { entries: ContextPreview["activated_lore"]; worldbooks?: WorldBook[] }) {
  const bookName = (id: string) => id.startsWith("character:") ? "角色内嵌世界书" : worldbooks.find((book) => book.id === id)?.name || id;
  const entryName = (entry: ContextPreview["activated_lore"][number]) => entry.keys.join("、") || entry.content.slice(0, 48) || entry.id;
  if (!entries.length) return <p className="muted">当前路径没有激活世界书条目。</p>;
  return <ol className="activated-lore-list">{entries.map((entry) => <li key={`${entry.worldbook_id}:${entry.id}`}>
    <strong>{entryName(entry)}</strong>
    <p className="muted">{bookName(entry.worldbook_id)} · {(entry.recursion_step || 0) === 0 ? "首次扫描" : `递归第 ${entry.recursion_step} 轮`}
      {entry.activation_reason === "constant" ? " · 常驻条目" : entry.activation_reason === "recursion_delay" ? " · 延迟到递归后启用" : ""}</p>
    {Boolean(entry.triggered_by?.length) && <p>触发条目：{entry.triggered_by!.map((trigger) => {
      const source = entries.find((item) => item.id === trigger.id && item.worldbook_id === trigger.worldbook_id);
      return `${bookName(trigger.worldbook_id)} / ${source ? entryName(source) : trigger.id}`;
    }).join("；")}</p>}
    <details><summary>查看条目内容</summary><pre>{entry.content}</pre></details>
  </li>)}</ol>;
}

export function ContextPreviewPanel({ selectedSessionId, previewQuery, worldbooks }: Props) {
  return (
      <CollapsibleSection
        contentId="inspector-context-preview-content"
        title="最终 Prompt 预览"
        icon={<Eye size={16} />}
        storageKey="yggdrasil-tavern.inspector.context-preview.expanded"
        className="inspector-section"
      >
        <div className="context-preview">
          {previewQuery.isPending && selectedSessionId ? <p className="muted">正在编译预览…</p> : previewQuery.error ? <p className="field-error">{previewQuery.error instanceof Error ? previewQuery.error.message : String(previewQuery.error)}</p> : previewQuery.data ? (
            <>
              <div className="context-budget-summary">
                <strong>Prompt 约 {previewQuery.data.estimated_input_tokens.toLocaleString()} tokens</strong>
                <span>输入上限 {previewQuery.data.effective_input_token_limit.toLocaleString()}</span>
                <span>输出上限 {previewQuery.data.effective_output_token_limit.toLocaleString()}</span>
                {previewQuery.data.dropped_history_count > 0 ? <span>已移除最旧历史 {previewQuery.data.dropped_history_count} 条</span> : null}
              </div>
              {previewQuery.data.diagnostics.length ? <div className="context-diagnostics">{previewQuery.data.diagnostics.map((item, index) => <p className={item.level === "error" ? "field-error" : "muted"} key={`${item.code}-${index}`}>{item.message}</p>)}</div> : null}
              <h3>System</h3><pre>{previewQuery.data.system}</pre><h3>Messages</h3><pre>{JSON.stringify(previewQuery.data.messages, null, 2)}</pre>
              <h3>激活的世界书条目</h3><ActivatedLoreList entries={previewQuery.data.activated_lore} worldbooks={worldbooks} />
            </>
          ) : <p className="muted">未选择会话</p>}
        </div>
      </CollapsibleSection>
  );
}
