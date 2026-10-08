import { useQuery } from "@tanstack/react-query";
import { Eye, GitFork, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, Message, SessionTree } from "../lib/api";
import { sortMessages } from "../lib/tree";

type Props = {
  tree?: SessionTree;
  selectedSessionId: string | null;
  onSessionUpdated?: () => void;
};

export function Inspector({ tree, selectedSessionId, onSessionUpdated }: Props) {
  const [systemPrompt, setSystemPrompt] = useState("");
  const [saving, setSaving] = useState(false);
  const previewQuery = useQuery({
    queryKey: ["context-preview", selectedSessionId, tree?.active_path_ids.join(":")],
    queryFn: () => api.contextPreview(selectedSessionId!),
    enabled: Boolean(selectedSessionId)
  });

  useEffect(() => {
    const preset = tree?.session.preset || {};
    setSystemPrompt(typeof preset.system_prompt === "string" ? preset.system_prompt : "");
  }, [tree?.session.id, tree?.session.preset]);

  async function saveSystemPrompt() {
    if (!tree || !selectedSessionId) return;
    setSaving(true);
    try {
      await api.updateSession(selectedSessionId, {
        preset: {
          ...(tree.session.preset || {}),
          system_prompt: systemPrompt
        }
      });
      await previewQuery.refetch();
      onSessionUpdated?.();
    } finally {
      setSaving(false);
    }
  }

  function renderBranch(parentId: string | null, depth = 0) {
    if (!tree) return null;
    const nodes = sortMessages(tree.messages.filter((message) => message.parent_id === parentId));
    return nodes.map((message) => {
      const active = tree.active_path_ids.includes(message.id);
      return (
        <div key={message.id}>
          <div className={active ? "branch-node active" : "branch-node"} style={{ paddingLeft: 10 + depth * 16 }}>
            <span>{message.role === "assistant" ? "A" : "U"}</span>
            <p>{message.content || "空消息"}</p>
          </div>
          {renderBranch(message.id, depth + 1)}
        </div>
      );
    });
  }

  return (
    <aside className="right-pane">
      <header className="pane-header">
        <div>
          <p className="eyebrow">Inspector</p>
          <h2>上下文与分支</h2>
        </div>
        <button className="icon-button" title="刷新上下文" onClick={() => previewQuery.refetch()}>
          <RefreshCcw size={17} />
        </button>
      </header>

      <section className="inspector-section">
        <div className="section-title">
          <Eye size={16} />
          <span>System Prompt</span>
        </div>
        <div className="system-editor">
          <textarea
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            placeholder="留空则使用默认 roleplay system prompt"
            disabled={!tree}
          />
          <button className="primary-button" disabled={!tree || saving} onClick={saveSystemPrompt}>
            保存系统提示词
          </button>
        </div>
      </section>

      <section className="inspector-section">
        <div className="section-title">
          <GitFork size={16} />
          <span>Branch Map</span>
        </div>
        <div className="branch-map">{tree ? renderBranch(null) : <p className="muted">暂无会话树。</p>}</div>
      </section>

      <section className="inspector-section">
        <div className="section-title">
          <Eye size={16} />
          <span>Context Preview</span>
        </div>
        <div className="context-preview">
          {previewQuery.data ? (
            <>
              <h3>System</h3>
              <pre>{previewQuery.data.system}</pre>
              <h3>Messages</h3>
              <pre>{JSON.stringify(previewQuery.data.messages, null, 2)}</pre>
              <h3>Activated Lore</h3>
              <pre>{JSON.stringify(previewQuery.data.activated_lore, null, 2)}</pre>
            </>
          ) : (
            <p className="muted">未选择会话</p>
          )}
        </div>
      </section>
    </aside>
  );
}
