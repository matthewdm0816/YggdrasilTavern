import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Edit3,
  GitBranch,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelRightClose,
  RefreshCcw,
  Send,
  Sparkles,
  Square,
  Sun,
  X
} from "lucide-react";
import { CharacterSummary, ChatSession, Message, RegexRule, SessionTree } from "../lib/api";
import { activeMessages as getActiveMessages, siblingsFor } from "../lib/tree";
import { useAppStore } from "../state/useAppStore";
import { RegexMessage } from "./RegexMessage";

type Props = {
  tree?: SessionTree;
  activeSession?: ChatSession;
  characters: CharacterSummary[];
  loading: boolean;
  loadError: string | null;
  streaming: boolean;
  onSend: (content: string) => Promise<void>;
  onGenerate: () => void;
  onStop: () => void;
  onRegenerate: (messageId: string) => void;
  onSelectMessage: (messageId: string) => Promise<void>;
  onCreateSwipe: (message: Message) => Promise<void>;
  onForkEdit: (message: Message, content: string) => Promise<void>;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  themePreference: "light" | "dark" | "system";
  onToggleTheme: () => void;
};

function usageNumber(usage: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 0;
}

function tokenSpeed(message: Message): number {
  const direct = usageNumber(message.usage, "tokens_per_second", "output_tokens_per_second");
  if (direct) return direct;
  const output = usageNumber(message.usage, "output_tokens", "completion_tokens");
  const durationMs = usageNumber(message.usage, "duration_ms", "generation_duration_ms");
  return output && durationMs ? output / (durationMs / 1000) : 0;
}

export function ChatWorkspace({
  tree,
  activeSession,
  characters,
  loading,
  loadError,
  streaming,
  onSend,
  onGenerate,
  onStop,
  onRegenerate,
  onSelectMessage,
  onCreateSwipe,
  onForkEdit,
  onToggleLeft,
  onToggleRight,
  themePreference,
  onToggleTheme
}: Props) {
  const sessionId = activeSession?.id || tree?.session.id || "";
  const draft = useAppStore((state) => sessionId ? state.drafts[sessionId] || "" : "");
  const setDraft = useAppStore((state) => state.setDraft);
  const edit = useAppStore((state) => sessionId ? state.edits[sessionId] : undefined);
  const setEdit = useAppStore((state) => state.setEdit);
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);

  const activeMessages = useMemo(() => getActiveMessages(tree), [tree]);
  const character = characters.find((item) => item.id === activeSession?.character_id);
  const regexRules = useMemo(() => {
    const value = activeSession?.preset?.regex_rules;
    return Array.isArray(value) ? value as RegexRule[] : [];
  }, [activeSession?.preset]);
  const contentRevision = activeMessages.map((message) => `${message.id}:${message.content.length}:${message.status}`).join("|");
  const nextThemeLabel = themePreference === "system" ? "亮色" : themePreference === "light" ? "暗色" : "跟随系统";
  const currentThemeLabel = themePreference === "system" ? "跟随系统" : themePreference === "light" ? "亮色" : "暗色";

  useLayoutEffect(() => {
    shouldFollowRef.current = true;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  }, [sessionId]);

  useEffect(() => {
    if (shouldFollowRef.current && scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: streaming ? "auto" : "smooth" });
    }
  }, [contentRevision, streaming]);

  function trackScroll() {
    const element = scrollRef.current;
    if (!element) return;
    shouldFollowRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!sessionId || !content || streaming) return;
    setInteractionError(null);
    setDraft(sessionId, "");
    try {
      await onSend(content);
      shouldFollowRef.current = true;
    } catch (cause) {
      setDraft(sessionId, content);
      setInteractionError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function startEdit(message: Message) {
    if (!sessionId) return;
    setEdit(sessionId, { messageId: message.id, value: message.content });
  }

  async function saveEdit(message: Message) {
    if (!sessionId || !edit) return;
    try {
      await onForkEdit(message, edit.value);
      setEdit(sessionId, undefined);
      setInteractionError(null);
    } catch (cause) {
      setInteractionError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <button className="icon-button desktop-pane-toggle" title="折叠/展开左栏" onClick={onToggleLeft}><PanelLeftClose size={17} /></button>
        <div className="session-title-block">
          <p className="eyebrow">Active Session</p>
          <h2>{activeSession?.title || "还没有会话"}</h2>
        </div>
        <div className="chat-actions">
          {character?.avatar_data_url && <img className="avatar" src={character.avatar_data_url} alt={character.name} />}
          <button
            className="icon-button theme-toggle"
            type="button"
            title={`当前主题：${currentThemeLabel}；点击切换到${nextThemeLabel}`}
            aria-label={`当前主题：${currentThemeLabel}；切换到${nextThemeLabel}`}
            onClick={onToggleTheme}
          >
            {themePreference === "system" ? <Monitor size={17} /> : themePreference === "light" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          {streaming ? (
            <button className="secondary-button danger-button" onClick={onStop}><Square size={14} />停止</button>
          ) : (
            <button className="secondary-button" disabled={!tree} onClick={onGenerate}><Sparkles size={16} />继续</button>
          )}
          <button className="icon-button desktop-pane-toggle" title="折叠/展开右栏" onClick={onToggleRight}><PanelRightClose size={17} /></button>
        </div>
      </header>

      <div className="message-scroll" ref={scrollRef} onScroll={trackScroll}>
        {loading && (
          <div className="tree-skeleton" aria-label="正在加载会话树">
            <span /><span /><span />
          </div>
        )}
        {loadError && <div className="inline-error" role="alert">会话树加载失败：{loadError}</div>}
        {!loading && !loadError && !tree && (
          <div className="empty-state"><GitBranch size={32} /><p>创建或选择一个会话后，树状路径会显示在这里。</p></div>
        )}
        {activeMessages.map((message) => {
          const siblings = siblingsFor(tree, message);
          const index = siblings.findIndex((item) => item.id === message.id);
          const previous = siblings[index - 1];
          const next = siblings[index + 1];
          const isEditing = edit?.messageId === message.id;
          const inputTokens = message.generation_run?.input_tokens || usageNumber(message.usage, "input_tokens", "prompt_tokens");
          const outputTokens = message.generation_run?.output_tokens || usageNumber(message.usage, "output_tokens", "completion_tokens") || message.token_count;
          const cachedTokens = message.generation_run?.cached_input_tokens || usageNumber(message.usage, "cached_input_tokens", "cached_tokens") || message.cached_tokens;
          const speed = message.generation_run?.tokens_per_second || tokenSpeed(message);
          return (
            <div key={message.id} className={`message-line ${message.role}`}>
              {message.role === "assistant" && character?.avatar_data_url && (
                <img className="message-avatar" src={character.avatar_data_url} alt="" aria-hidden="true" />
              )}
              <article className={`message-row ${message.role}`}>
                <div className="message-meta"><strong>{message.speaker || message.role}</strong><span>{message.status}</span></div>
                {message.thinking_content && (
                  <details className="thinking-box" open={message.status === "streaming"}>
                    <summary>Thinking · {message.thinking_token_count || "估算中"} tokens</summary>
                    <pre>{message.thinking_content}</pre>
                  </details>
                )}
                {isEditing ? (
                  <div className="editor-box">
                    <label className="form-field"><span>编辑消息内容</span><textarea value={edit.value} onChange={(event) => setEdit(sessionId, { ...edit, value: event.target.value })} /></label>
                    <p className="editor-hint">保存会创建新的 sibling/swipe；原消息及其后代保持不变。</p>
                    <div className="inline-actions">
                      <button className="primary-button" onClick={() => saveEdit(message)}>保存为新 swipe</button>
                      <button className="icon-button" title="取消" onClick={() => setEdit(sessionId, undefined)}><X size={16} /></button>
                    </div>
                  </div>
                ) : message.content ? (
                  <RegexMessage content={message.content} role={message.role} rules={regexRules} />
                ) : message.status === "streaming" ? <p className="message-content">…</p> : null}
                {message.error && <p className="message-error">{message.error}</p>}
                <div className="message-toolbar">
                  {inputTokens > 0 && <span className="token-pill">输入 {inputTokens} tok</span>}
                  <span className="token-pill">输出 {outputTokens || 0} tok</span>
                  {cachedTokens > 0 && <span className="token-pill cache">缓存输入 {cachedTokens} tok</span>}
                  {speed > 0 && <span className="token-pill">{speed.toFixed(1)} tok/s</span>}
                  <button className="icon-button" title="上一个 swipe" disabled={!previous} onClick={() => previous && onSelectMessage(previous.id)}><ChevronLeft size={16} /></button>
                  <span className="swipe-counter">{index + 1}/{siblings.length}</span>
                  <button className="icon-button" title="下一个 swipe" disabled={!next} onClick={() => next && onSelectMessage(next.id)}><ChevronRight size={16} /></button>
                  <button className="icon-button" title="复制为新 swipe" onClick={() => onCreateSwipe(message)}><CopyPlus size={16} /></button>
                  <button className="icon-button" title="编辑并创建新 swipe" onClick={() => startEdit(message)}><Edit3 size={16} /></button>
                  {message.role === "assistant" && (
                    <button className="icon-button" title="重新生成此 swipe" disabled={streaming} onClick={() => onRegenerate(message.id)}><RefreshCcw size={16} /></button>
                  )}
                </div>
              </article>
            </div>
          );
        })}
      </div>

      {(interactionError || loadError) && <div className="composer-error" role="alert">{interactionError || loadError}</div>}
      <form className="composer" onSubmit={submit}>
        <label className="composer-field"><span>发送消息</span><textarea
            value={draft}
            onChange={(event) => sessionId && setDraft(sessionId, event.target.value)}
            placeholder="输入内容；发送后自动生成角色回复"
            disabled={!tree || streaming}
          /></label>
        <button className="send-button" disabled={!tree || streaming || !draft.trim()} title="发送"><Send size={18} /></button>
      </form>
    </section>
  );
}
