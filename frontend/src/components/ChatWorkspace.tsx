import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  Edit3,
  GitBranch,
  Menu,
  GitFork,
  RefreshCcw,
  Send,
  Sparkles,
  Square,
  X
} from "lucide-react";
import { CharacterSummary, ChatSession, Message, RegexRule, SessionTree } from "../lib/api";
import { activeMessages as getActiveMessages, siblingsFor } from "../lib/tree";
import { useAppStore } from "../state/useAppStore";
import { AutoSizeTextarea } from "./AutoSizeTextarea";
import { ForestTreeView } from "./ForestTreeView";
import { RegexMessage } from "./RegexMessage";
import { ActionMenu } from "./ActionMenu";

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
  onForkEdit: (message: Message, content: string, thinkingContent: string) => Promise<void>;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  treeViewOpen: boolean;
  onOpenTree: () => void;
  onCloseTree: () => void;
  appearanceControls: ReactNode;
  modelPicker: ReactNode;
  canGenerate: boolean;
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
  onForkEdit,
  onToggleLeft,
  onToggleRight,
  leftOpen,
  rightOpen,
  treeViewOpen,
  onOpenTree,
  onCloseTree,
  appearanceControls,
  modelPicker,
  canGenerate
}: Props) {
  const sessionId = activeSession?.id || tree?.session.id || "";
  const draft = useAppStore((state) => sessionId ? state.drafts[sessionId] || "" : "");
  const setDraft = useAppStore((state) => state.setDraft);
  const edit = useAppStore((state) => sessionId ? state.edits[sessionId] : undefined);
  const setEdit = useAppStore((state) => state.setEdit);
  const [interactionErrors, setInteractionErrors] = useState<Record<string, string | null>>({});
  const interactionError = interactionErrors[sessionId] || null;
  function setInteractionError(detail: string | null) {
    setInteractionErrors((current) => ({ ...current, [sessionId]: detail }));
  }
  const pendingSubmissions = useRef(new Set<string>());
  const pendingEdits = useRef(new Set<string>());
  const [submittingSessions, setSubmittingSessions] = useState<Record<string, boolean>>({});
  const [savingEditSessions, setSavingEditSessions] = useState<Record<string, boolean>>({});
  const submitting = Boolean(submittingSessions[sessionId]);
  const savingEdit = Boolean(savingEditSessions[sessionId]);
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
    if (!sessionId || !content || streaming || !canGenerate || pendingSubmissions.current.has(sessionId)) return;
    pendingSubmissions.current.add(sessionId);
    setSubmittingSessions((current) => ({ ...current, [sessionId]: true }));
    setInteractionError(null);
    setDraft(sessionId, "");
    try {
      await onSend(content);
      shouldFollowRef.current = true;
    } catch (cause) {
      const existingDraft = useAppStore.getState().drafts[sessionId];
      if (!existingDraft) setDraft(sessionId, content);
      const detail = cause instanceof Error ? cause.message : String(cause);
      setInteractionError(existingDraft ? "发送失败：" + detail + "。当前草稿已保留；未发送的内容：" + content : detail);
    } finally {
      pendingSubmissions.current.delete(sessionId);
      setSubmittingSessions((current) => ({ ...current, [sessionId]: false }));
    }
  }

  function startEdit(message: Message) {
    if (!sessionId) return;
    setEdit(sessionId, messageEditDraft(message));
  }

  async function saveEdit(message: Message) {
    if (!sessionId || !edit || pendingEdits.current.has(sessionId)) return;
    const submitted = edit;
    if (submitted.value === message.content && submitted.thinkingValue === message.thinking_content) return;
    pendingEdits.current.add(sessionId);
    setSavingEditSessions((current) => ({ ...current, [sessionId]: true }));
    try {
      await onForkEdit(message, submitted.value, submitted.thinkingValue);
      if (useAppStore.getState().edits[sessionId] === submitted) setEdit(sessionId, undefined);
      setInteractionError(null);
    } catch (cause) {
      setInteractionError("消息分支保存失败：" + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      pendingEdits.current.delete(sessionId);
      setSavingEditSessions((current) => ({ ...current, [sessionId]: false }));
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

  async function copyMessage(message: Message) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("浏览器未提供剪贴板访问，请在 HTTPS 或本机地址下使用复制功能。");
      await navigator.clipboard.writeText(message.content);
      setInteractionError(null);
    } catch (cause) {
      setInteractionError("复制消息失败：" + (cause instanceof Error ? cause.message : String(cause)));
    }
  }

  async function duplicateMessage(message: Message) {
    try {
      await onCreateSwipe(message);
      setInteractionError(null);
    } catch (cause) {
      setInteractionError("创建消息分支失败：" + (cause instanceof Error ? cause.message : String(cause)));
    }
  }

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <div className="chat-header-start">
          <button className="icon-button" type="button" title="会话与资源" aria-label="会话与资源" aria-expanded={leftOpen} onClick={onToggleLeft}><Menu size={20} /></button>
        </div>
        <div className="session-title-block">
          <h2 title={activeSession?.title || "还没有会话"}>{activeSession?.title || "还没有会话"}</h2>
        </div>
        <div className="chat-actions">
          <button className="icon-button" type="button" title="当前路径分支与会话设置" aria-label="当前路径分支与会话设置" aria-expanded={rightOpen} onClick={onToggleRight}><GitFork size={19} /></button>
          <ActionMenu label="聊天与外观选项">
            <button type="button" data-close-menu disabled={!tree} onClick={onOpenTree}><GitBranch size={16} />浏览完整聊天树</button>
            {appearanceControls}
          </ActionMenu>
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
                <div className="message-meta"><strong>{message.speaker || message.role}</strong>{message.status !== "complete" && <span aria-live="polite">{({ streaming: "正在生成", cancelled: "已停止", failed: "生成失败", interrupted: "已中断" } as Record<string, string>)[message.status] || presentation.statusLabel}</span>}</div>
                {message.thinking_content && (
                  <details className="thinking-box" open={message.status === "streaming"}>
                    <summary>Thinking · {message.thinking_token_count || "估算中"} tokens</summary>
                    <pre>{message.thinking_content}</pre>
                  </details>
                )}
                {isEditing ? (
                  <div className="editor-box">
                    <label className="form-field"><span>编辑消息正文</span><AutoSizeTextarea disabled={savingEdit} value={edit.value} onChange={(event) => setEdit(sessionId, { ...edit, value: event.target.value })} /></label>
                    {(message.role === "assistant" || message.thinking_content) && (
                      <label className="form-field"><span>编辑 Thinking（可留空）</span><AutoSizeTextarea disabled={savingEdit} value={edit.thinkingValue} onChange={(event) => setEdit(sessionId, { ...edit, thinkingValue: event.target.value })} /></label>
                    )}
                    <p className="editor-hint">保存会在同一父消息下创建一个新分支，原消息及其后续消息保持不变。</p>
                    <div className="inline-actions">
                      <button className="primary-button" disabled={savingEdit || streaming || (edit.value === message.content && edit.thinkingValue === message.thinking_content)} onClick={() => saveEdit(message)}>{savingEdit ? "保存中…" : "保存为新分支"}</button>
                      <button className="icon-button" title="取消" onClick={() => setEdit(sessionId, undefined)}><X size={16} /></button>
                    </div>
                  </div>
                ) : message.content ? (
                  <RegexMessage content={message.content} role={message.role} rules={regexRules} />
                ) : message.status === "streaming" ? <p className="message-content">…</p> : null}
                {message.error && <p className="message-error">{message.error}</p>}
                <footer className="message-footer">
                  {message.role === "assistant" && <small className="message-usage"
                    title={tokenDisplay.outputEstimated ? "根据已保存的正文和思考内容估算用量" : "模型服务返回的用量"}>
                    {inputTokens > 0 && <span>输入 {inputTokens}</span>}
                    <span>输出{tokenDisplay.outputEstimated ? "约 " : " "}{outputTokens || 0} tokens</span>
                    {cachedTokens > 0 && <span>缓存 {cachedTokens}</span>}
                    {speed > 0 && <span>{speed.toFixed(1)} tokens/s</span>}
                  </small>}
                  <div className="message-branch-actions" aria-label="消息分支切换">
                    <button className="icon-button" type="button" title="上一个消息分支" aria-label="上一个消息分支" disabled={!previous} onClick={() => previous && selectSwipeFromToolbar(previous.id)}><ChevronLeft size={16} /></button>
                    <span className="swipe-counter" aria-label={"第 " + (index + 1) + " 个，共 " + siblings.length + " 个消息分支"}>{index + 1}/{siblings.length}</span>
                    <button className="icon-button" type="button" title="下一个消息分支" aria-label="下一个消息分支" disabled={!next} onClick={() => next && selectSwipeFromToolbar(next.id)}><ChevronRight size={16} /></button>
                    <ActionMenu label="消息操作">
                      <button type="button" data-close-menu disabled={!message.content} onClick={() => void copyMessage(message)}><Copy size={16} />复制正文</button>
                      <button type="button" data-close-menu disabled={streaming} onClick={() => void duplicateMessage(message)}><CopyPlus size={16} />复制为新分支</button>
                      <button type="button" data-close-menu disabled={streaming} onClick={() => startEdit(message)}><Edit3 size={16} />编辑为新分支</button>
                      {message.role === "assistant" && <button type="button" data-close-menu disabled={streaming || submitting || !canGenerate} onClick={() => onRegenerate(message.id)}><RefreshCcw size={16} />重新生成此回复</button>}
                    </ActionMenu>
                  </div>
                </footer>
              </article>
            </div>
          );
        })}
      </div>

      <div className="composer-area">
        {(interactionError || loadError) && <div className="composer-error" role="alert">{interactionError || loadError}</div>}
        <div className="composer-tools">
          {modelPicker}
          <button className="secondary-button continue-generation" type="button" title="从当前路径继续生成回复" disabled={!tree || streaming || submitting || !canGenerate} onClick={onGenerate}><Sparkles size={15} /><span>继续</span></button>
        </div>
        <form className="composer" onSubmit={submit}>
          <label className="composer-field"><span className="sr-only">发送消息</span><textarea
              value={draft}
              onChange={(event) => sessionId && setDraft(sessionId, event.target.value)}
              placeholder="输入消息…"
              disabled={!tree || streaming || submitting}
            /></label>
          {streaming ? (
            <button className="send-button composer-stop-button" type="button" title="停止生成" aria-label="停止生成" onClick={onStop}><Square size={17} /></button>
          ) : (
            <button className="send-button" disabled={!tree || !draft.trim() || !canGenerate || submitting} title="发送" aria-label="发送"><Send size={18} /></button>
          )}
        </form>
      </div>
      {treeViewOpen && tree && (
        <ForestTreeView
          tree={tree}
          onClose={onCloseTree}
          onSelectMessage={selectMessageAndReveal}
        />
      )}
    </section>
  );
}
