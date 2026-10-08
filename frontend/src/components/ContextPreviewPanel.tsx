import type { UseQueryResult } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import type { ContextPreview } from "../lib/api";
import { CollapsibleSection } from "./CollapsibleSection";

type Props = {
  selectedSessionId: string | null;
  previewQuery: UseQueryResult<ContextPreview, Error>;
};

export function ContextPreviewPanel({ selectedSessionId, previewQuery }: Props) {
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
              <h3>System</h3><pre>{previewQuery.data.system}</pre><h3>Messages</h3><pre>{JSON.stringify(previewQuery.data.messages, null, 2)}</pre><h3>Activated Lore</h3><pre>{JSON.stringify(previewQuery.data.activated_lore, null, 2)}</pre>
            </>
          ) : <p className="muted">未选择会话</p>}
        </div>
      </CollapsibleSection>
  );
}
