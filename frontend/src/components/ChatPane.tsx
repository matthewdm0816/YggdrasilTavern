import { FormEvent, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CopyPlus, Edit3, GitBranch, RefreshCcw, Send, Sparkles, X } from "lucide-react";
import { Character, ChatSession, Message, SessionTree } from "../lib/api";
import { activeMessages as getActiveMessages, siblingsFor } from "../lib/tree";

type Props = {
  tree?: SessionTree;
  activeSession?: ChatSession;
  characters: Character[];
  streaming: boolean;
  onSend: (content: string) => Promise<void>;
  onGenerate: () => void;
  onRegenerate: (messageId: string) => void;
  onSelectMessage: (messageId: string) => void;
  onCreateSwipe: (message: Message) => void;
  onUpdateMessage: (messageId: string, content: string) => Promise<void>;
};

export function ChatPane({
  tree,
  activeSession,
  characters,
  streaming,
  onSend,
  onGenerate,
  onRegenerate,
  onSelectMessage,
  onCreateSwipe,
  onUpdateMessage
}: Props) {
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const activeMessages = useMemo(() => {
    return getActiveMessages(tree);
  }, [tree]);

  const character = characters.find((item) => item.id === activeSession?.character_id);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || streaming) return;
    setDraft("");
    await onSend(content);
  }

  function startEdit(message: Message) {
    setEditingId(message.id);
    setEditDraft(message.content);
  }

  async function saveEdit(messageId: string) {
    await onUpdateMessage(messageId, editDraft);
    setEditingId(null);
    setEditDraft("");
  }

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <div className="session-title-block">
          <p className="eyebrow">Active Session</p>
          <h2>{activeSession?.title || "还没有会话"}</h2>
        </div>
        <div className="chat-actions">
          {character?.avatar_data_url && <img className="avatar" src={character.avatar_data_url} alt={character.name} />}
          <button className="secondary-button" disabled={!tree || streaming} onClick={onGenerate}>
            <Sparkles size={16} />
            继续
          </button>
        </div>
      </header>

      <div className="message-scroll">
        {!tree && (
          <div className="empty-state">
            <GitBranch size={32} />
            <p>创建或选择一个会话后，树状路径会显示在这里。</p>
          </div>
        )}
        {activeMessages.map((message) => {
          const siblings = siblingsFor(tree, message);
          const index = siblings.findIndex((item) => item.id === message.id);
          const previous = siblings[index - 1];
          const next = siblings[index + 1];
          const isEditing = editingId === message.id;
          return (
            <article key={message.id} className={`message-row ${message.role}`}>
              <div className="message-meta">
                <strong>{message.speaker || message.role}</strong>
                <span>{message.status}</span>
              </div>
              {message.thinking_content && (
                <details className="thinking-box" open={message.status === "streaming"}>
                  <summary>Thinking · {message.thinking_token_count || "估算中"} tokens</summary>
                  <pre>{message.thinking_content}</pre>
                </details>
              )}
              {isEditing ? (
                <div className="editor-box">
                  <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} />
                  <div className="inline-actions">
                    <button className="primary-button" onClick={() => saveEdit(message.id)}>
                      保存
                    </button>
                    <button className="icon-button" title="取消" onClick={() => setEditingId(null)}>
                      <X size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="message-content">{message.content || (message.status === "streaming" ? "…" : "")}</p>
              )}
              {message.error && <p className="message-error">{message.error}</p>}
              <div className="message-toolbar">
                <span className="token-pill">正文 {message.token_count || 0} tok</span>
                {message.cached_tokens > 0 && <span className="token-pill cache">缓存 {message.cached_tokens} tok</span>}
                <button className="icon-button" title="上一个 swipe" disabled={!previous} onClick={() => previous && onSelectMessage(previous.id)}>
                  <ChevronLeft size={16} />
                </button>
                <span className="swipe-counter">
                  {index + 1}/{siblings.length}
                </span>
                <button className="icon-button" title="下一个 swipe" disabled={!next} onClick={() => next && onSelectMessage(next.id)}>
                  <ChevronRight size={16} />
                </button>
                <button className="icon-button" title="复制为新 swipe" onClick={() => onCreateSwipe(message)}>
                  <CopyPlus size={16} />
                </button>
                <button className="icon-button" title="编辑消息" onClick={() => startEdit(message)}>
                  <Edit3 size={16} />
                </button>
                {message.role === "assistant" && (
                  <button className="icon-button" title="重新生成此 swipe" disabled={streaming} onClick={() => onRegenerate(message.id)}>
                    <RefreshCcw size={16} />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <form className="composer" onSubmit={submit}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="输入下一条 user message；发送后会自动生成 assistant 回复"
          disabled={!tree || streaming}
        />
        <button className="send-button" disabled={!tree || streaming || !draft.trim()} title="发送">
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}
