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
import { AutoSizeTextarea } from "./AutoSizeTextarea";
import { ForestTreeView } from "./ForestTreeView";
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
  onUpdateMessage: (message: Message, content: string, thinkingContent: string) => Promise<void>;
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

function tokenSpeed(message: Pick<Message, "usage">): number {
  const direct = usageNumber(message.usage, "tokens_per_second", "output_tokens_per_second");
  if (direct) return direct;
  const output = usageNumber(message.usage, "output_tokens", "completion_tokens");
  const durationMs = usageNumber(message.usage, "duration_ms", "generation_duration_ms");
  return output && durationMs ? output / (durationMs / 1000) : 0;
}

type TokenDisplayMessage = Pick<
  Message,
  "status" | "token_count" | "thinking_token_count" | "provider_metadata" | "usage"
> & {
  generation_run?: Pick<
    NonNullable<Message["generation_run"]>,
    "output_tokens" | "duration_seconds" | "tokens_per_second"
  > | null;
};

export function generationTokenDisplay(message: TokenDisplayMessage) {
  const usageOutput = usageNumber(message.usage, "output_tokens", "completion_tokens");
  const providerOutput = message.generation_run?.output_tokens ?? (usageOutput || null);
  const observedOutput = Math.max(0, message.token_count) + Math.max(0, message.thinking_token_count);
  const incomplete = message.status !== "complete";
  const implausiblyLow = Boolean(
    providerOutput
    && observedOutput >= 32
    && observedOutput > providerOutput * 3
  );
  const useObserved = observedOutput > 0 && (
    providerOutput === null
    || providerOutput <= 0
    || (incomplete && observedOutput > providerOutput)
    || implausiblyLow
  );
  const outputTokens = useObserved ? observedOutput : providerOutput || 0;
  const wasServerReconciled = message.provider_metadata.usage_reconciled === true;
  let tokensPerSecond = message.generation_run?.tokens_per_second || tokenSpeed(message);
  if (useObserved && message.generation_run?.duration_seconds) {
    tokensPerSecond = outputTokens / message.generation_run.duration_seconds;
  }
  return {
    outputTokens,
    outputEstimated: useObserved || wasServerReconciled,
    tokensPerSecond
  };
}

export function getMessagePresentation(message: Pick<Message, "role" | "status">) {
  const isStreaming = message.status === "streaming";
  return {
    isStreaming,
    rowClassName: `message-row ${message.role}${isStreaming ? " is-streaming" : ""}`,
    statusLabel: isStreaming ? "正在生成" : message.status
  };
}

export function messageEditDraft(message: Pick<Message, "id" | "content" | "thinking_content">) {
  return {
    messageId: message.id,
    value: message.content,
    thinkingValue: message.thinking_content
  };
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
  onUpdateMessage,
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
  const [submittingBySession, setSubmittingBySession] = useState<Record<string, boolean>>({});
  const submitting = Boolean(submittingBySession[sessionId]);
  const [savingEdit, setSavingEdit] = useState(false);
  const submitPendingRef = useRef(new Set<string>());
  const [treeViewOpen, setTreeViewOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const pendingRevealRef = useRef<string | null>(null);

  const activeMessages = useMemo(() => getActiveMessages(tree), [tree]);
  const character = characters.find((item) => item.id === activeSession?.character_id);
  const regexRules = useMemo(() => {
    const value = activeSession?.preset?.regex_rules;
    return Array.isArray(value) ? value as RegexRule[] : [];
  }, [activeSession?.preset]);
  const contentRevision = activeMessages.map((message) => `${message.id}:${message.content.length}:${message.thinking_content.length}:${message.status}`).join("|");
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

  useLayoutEffect(() => {
    const messageId = pendingRevealRef.current;
    if (messageId) revealMessage(messageId);
  }, [activeMessages]);

  function trackScroll() {
    const element = scrollRef.current;
    if (!element) return;
    shouldFollowRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!sessionId || !tree || streaming || submitPendingRef.current.has(sessionId)) return;
    submitPendingRef.current.add(sessionId);
    setSubmittingBySession((current) => ({ ...current, [sessionId]: true }));
    const submittedDraft = draft;
    setInteractionError(null);
    setDraft(sessionId, "");
    try {
      await onSend(content);
      shouldFollowRef.current = true;
    } catch (cause) {
      const nextDraft = useAppStore.getState().drafts[sessionId] || "";
      setDraft(sessionId, nextDraft ? `${submittedDraft}\n${nextDraft}` : submittedDraft);
      setInteractionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitPendingRef.current.delete(sessionId);
      setSubmittingBySession((current) => ({ ...current, [sessionId]: false }));
    }
  }

  function startEdit(message: Message) {
    if (!sessionId) return;
    setEdit(sessionId, messageEditDraft(message));
  }

  async function saveEdit(message: Message) {
    if (!sessionId || !edit || savingEdit) return;
    setSavingEdit(true);
    try {
      await onUpdateMessage(message, edit.value, edit.thinkingValue);
      if (useAppStore.getState().edits[sessionId] === edit) setEdit(sessionId, undefined);
      setInteractionError(null);
    } catch (cause) {
      setInteractionError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSavingEdit(false);
    }
  }

  function revealMessage(messageId: string) {
    const container = scrollRef.current;
    if (!container) return;
    const target = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
      .find((element) => element.dataset.messageId === messageId);
    if (!target) return;
    shouldFollowRef.current = false;
    pendingRevealRef.current = null;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  async function selectMessageAndReveal(messageId: string) {
    pendingRevealRef.current = messageId;
    shouldFollowRef.current = false;
    setInteractionError(null);
    try {
      await onSelectMessage(messageId);
      requestAnimationFrame(() => revealMessage(messageId));
    } catch (cause) {
      pendingRevealRef.current = null;
      const detail = cause instanceof Error ? cause.message : String(cause);
      setInteractionError(`无法切换到所选消息：${detail}`);
      throw cause;
    }
  }

  function selectSwipeFromToolbar(messageId: string) {
    void selectMessageAndReveal(messageId).catch((cause) => {
      console.error("Swipe 切换失败", cause);
    });
  }

  async function copySwipe(message: Message) {
    try {
      await onCreateSwipe(message);
      setInteractionError(null);
    } catch (cause) {
      setInteractionError(`复制消息失败：${cause instanceof Error ? cause.message : String(cause)}`);
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
            className="secondary-button tree-view-trigger"
            type="button"
            title="打开完整聊天森林"
            disabled={!tree}
            onClick={() => setTreeViewOpen(true)}
          >
            <GitBranch size={16} /><span>Tree View</span>
          </button>
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
            <button className="secondary-button danger-button" title="停止生成" aria-label="停止生成" onClick={onStop}><Square size={14} />停止</button>
          ) : (
            <button className="secondary-button" title="继续生成" aria-label="继续生成" disabled={!tree || submitting} onClick={onGenerate}><Sparkles size={16} />继续</button>
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
          const tokenDisplay = generationTokenDisplay(message);
          const outputTokens = tokenDisplay.outputTokens;
          const cachedTokens = message.generation_run?.cached_input_tokens || usageNumber(message.usage, "cached_input_tokens", "cached_tokens") || message.cached_tokens;
          const speed = tokenDisplay.tokensPerSecond;
          const presentation = getMessagePresentation(message);
          return (
            <div key={message.id} className={`message-line ${message.role}`} data-message-id={message.id}>
              {message.role === "assistant" && character?.avatar_data_url && (
                <img className="message-avatar" src={character.avatar_data_url} alt="" aria-hidden="true" />
              )}
              <article className={presentation.rowClassName} aria-busy={presentation.isStreaming}>
                <div className="message-meta"><strong>{message.speaker || message.role}</strong><span aria-live="polite">{presentation.statusLabel}</span></div>
                {message.thinking_content && (
                  <details className="thinking-box" open={message.status === "streaming"}>
                    <summary>Thinking · {message.thinking_token_count || "估算中"} tokens</summary>
                    <pre>{message.thinking_content}</pre>
                  </details>
                )}
                {isEditing ? (
                  <div className="editor-box">
                    <label className="form-field"><span>编辑消息正文</span><AutoSizeTextarea value={edit.value} onChange={(event) => setEdit(sessionId, { ...edit, value: event.target.value })} /></label>
                    {(message.role === "assistant" || message.thinking_content) && (
                      <label className="form-field"><span>编辑 Thinking（可留空）</span><AutoSizeTextarea value={edit.thinkingValue} onChange={(event) => setEdit(sessionId, { ...edit, thinkingValue: event.target.value })} /></label>
                    )}
                    <p className="editor-hint">直接修改这条消息的正文和 Thinking，后续回复将使用修改后的内容。</p>
                    <div className="inline-actions">
                      <button className="primary-button" disabled={savingEdit} onClick={() => saveEdit(message)}>{savingEdit ? "保存中…" : "保存修改"}</button>
                      <button className="icon-button" title="取消" disabled={savingEdit} onClick={() => setEdit(sessionId, undefined)}><X size={16} /></button>
                    </div>
                  </div>
                ) : message.content ? (
                  <RegexMessage content={message.content} role={message.role} rules={regexRules} />
                ) : message.status === "streaming" ? <p className="message-content">…</p> : null}
                {message.error && <p className="message-error">{message.error}</p>}
                <div className="message-toolbar">
                  <div className="message-stats" aria-label="Token 用量与速度，可左右滑动查看">
                  {inputTokens > 0 && <span className="token-pill">输入 {inputTokens} tok</span>}
                  <span
                    className="token-pill"
                    title={tokenDisplay.outputEstimated ? "Provider 未返回可信的最终用量；根据已保存正文与 Thinking 估算" : "Provider 返回的最终输出用量"}
                  >输出{tokenDisplay.outputEstimated ? "约 " : " "}{outputTokens || 0} tok</span>
                  {cachedTokens > 0 && <span className="token-pill cache">缓存输入 {cachedTokens} tok</span>}
                  {speed > 0 && <span className="token-pill">{speed.toFixed(1)} tok/s</span>}
                  </div>
                  <div className="message-tools">
                  <button className="icon-button" title="上一个 swipe" disabled={!previous} onClick={() => previous && selectSwipeFromToolbar(previous.id)}><ChevronLeft size={16} /></button>
                  <span className="swipe-counter">{index + 1}/{siblings.length}</span>
                  <button className="icon-button" title="下一个 swipe" disabled={!next} onClick={() => next && selectSwipeFromToolbar(next.id)}><ChevronRight size={16} /></button>
                  <button className="icon-button" title="复制为新 swipe" onClick={() => copySwipe(message)}><CopyPlus size={16} /></button>
                  <button className="icon-button" title="编辑消息" disabled={message.status === "streaming"} onClick={() => startEdit(message)}><Edit3 size={16} /></button>
                  {message.role === "assistant" && (
                    <button className="icon-button" title="重新生成此 swipe" disabled={streaming} onClick={() => onRegenerate(message.id)}><RefreshCcw size={16} /></button>
                  )}
                  </div>
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
            placeholder={streaming ? "可以先写下一条消息；生成结束后再发送" : "输入消息；留空发送可继续生成"}
            disabled={!tree}
          /></label>
        {streaming ? (
          <button className="send-button composer-stop-button" type="button" title="停止生成" aria-label="停止生成" onClick={onStop}><Square size={17} /></button>
        ) : (
          <button className="send-button" disabled={!tree || submitting} title={draft.trim() ? "发送" : "空白发送：继续生成"} aria-label={draft.trim() ? "发送" : "空白发送：继续生成"}><Send size={18} /></button>
        )}
      </form>
      {treeViewOpen && tree && (
        <ForestTreeView
          tree={tree}
          onClose={() => setTreeViewOpen(false)}
          onSelectMessage={selectMessageAndReveal}
        />
      )}
    </section>
  );
}
