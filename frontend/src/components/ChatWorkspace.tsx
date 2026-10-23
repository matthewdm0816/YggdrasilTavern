import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  Edit3,
  GitBranch,
  Menu,
  LoaderCircle,
  Network,
  PanelRight,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  Volume2,
  X
} from "lucide-react";
import { api, CharacterSummary, ChatSession, Message, MessageDeleteScope, RegexRule, SessionTree } from "../lib/api";
import { activeMessages as getActiveMessages, buildMessageIndex, siblingsFor } from "../lib/tree";
import { useAppStore } from "../state/useAppStore";
import { messageErrorText, messageStatusLabel } from "../lib/messageStatus";
import { useMediaQuery } from "../lib/useMediaQuery";
import { AutoSizeTextarea } from "./AutoSizeTextarea";
import { ForestTreeView } from "./ForestTreeView";
import { RegexMessage } from "./RegexMessage";
import { ActionMenu } from "./ActionMenu";
import "../styles/chat-message-actions.css";

type Props = {
  tree?: SessionTree;
  activeSession?: ChatSession;
  characters: CharacterSummary[];
  loading: boolean;
  loadError: string | null;
  streaming: boolean;
  mutating: boolean;
  onSend: (content: string) => Promise<void>;
  onGenerate: () => void;
  onStop: () => void;
  onRegenerate: (messageId: string) => void;
  onSelectMessage: (messageId: string) => Promise<void>;
  onCreateSwipe: (message: Message, content?: string, thinkingContent?: string) => Promise<void>;
  onUpdateMessage: (message: Message, content: string, thinkingContent: string) => Promise<void>;
  onChangeMessageRole: (message: Message, role: Message["role"]) => Promise<void>;
  onDeleteMessage: (message: Message, scope: MessageDeleteScope) => Promise<number>;
  onPruneEmptyBranches: () => Promise<number>;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  treeViewOpen: boolean;
  onOpenTree: () => void;
  onCloseTree: () => void;
  modelPicker: ReactNode;
  ttsControls?: ReactNode;
  onReadMessage?: (message: Message) => void;
  regexRules: RegexRule[];
  canGenerate: boolean;
  onQuickCreateSession?: (payload: Parameters<typeof api.createSession>[0]) => Promise<ChatSession>;
  onOpenSettings?: () => void;
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
    statusLabel: messageStatusLabel(message.status)
  };
}

export function messageEditDraft(message: Pick<Message, "id" | "content" | "thinking_content">) {
  return {
    messageId: message.id,
    value: message.content,
    thinkingValue: message.thinking_content
  };
}

export function messageEditHasChanges(
  edit: ReturnType<typeof messageEditDraft>,
  message: Pick<Message, "content" | "thinking_content"> | undefined
) {
  return !message || edit.value !== message.content || edit.thinkingValue !== message.thinking_content;
}

export function ChatWorkspace({
  tree,
  activeSession,
  characters,
  loading,
  loadError,
  streaming,
  mutating,
  onSend,
  onGenerate,
  onStop,
  onRegenerate,
  onSelectMessage,
  onCreateSwipe,
  onUpdateMessage,
  onChangeMessageRole,
  onDeleteMessage,
  onPruneEmptyBranches,
  onToggleLeft,
  onToggleRight,
  leftOpen,
  rightOpen,
  treeViewOpen,
  onOpenTree,
  onCloseTree,
  modelPicker,
  ttsControls,
  onReadMessage,
  regexRules,
  canGenerate,
  onQuickCreateSession,
  onOpenSettings
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
  const [quickCreatingId, setQuickCreatingId] = useState<string | null>(null);
  const pendingTreeActions = useRef(new Set<string>());
  const [treeActionLabels, setTreeActionLabels] = useState<Record<string, string | null>>({});
  const [treeActionResults, setTreeActionResults] = useState<Record<string, string | null>>({});
  const treeActionLabel = treeActionLabels[sessionId];
  const treeActionResult = treeActionResults[sessionId];
  const submitting = Boolean(submittingSessions[sessionId]);
  const savingEdit = Boolean(savingEditSessions[sessionId]);
  const messageActionsBusy = streaming || submitting || savingEdit || mutating || Boolean(treeActionLabel);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowRef = useRef(true);
  const pendingRevealRef = useRef<string | null>(null);

  const messageIndex = useMemo(() => buildMessageIndex(tree?.messages || []), [tree?.messages]);
  const activeMessages = useMemo(() => getActiveMessages(tree, messageIndex), [tree, messageIndex]);
  const character = characters.find((item) => item.id === activeSession?.character_id);
  const hasKeyboardShortcut = useMediaQuery("(hover: hover) and (pointer: fine)");
  const contentRevision = activeMessages.map((message) => `${message.id}:${message.content.length}:${message.thinking_content.length}:${message.status}`).join("|");

  useEffect(() => {
    if (tree && edit && !tree.messages.some((message) => message.id === edit.messageId)) setEdit(sessionId, undefined);
  }, [tree, edit, sessionId, setEdit]);

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

  async function submitContent() {
    const content = draft.trim();
    if (!sessionId || !tree || messageActionsBusy || !canGenerate || pendingSubmissions.current.has(sessionId)) return;
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    await submitContent();
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void submitContent();
    }
  }

  async function quickStartWithCharacter(target: CharacterSummary) {
    if (!onQuickCreateSession || quickCreatingId) return;
    setQuickCreatingId(target.id);
    setInteractionError(null);
    try {
      await onQuickCreateSession({
        title: target.name,
        character_id: target.id,
        preset: { auto_greeting: true }
      });
    } catch (cause) {
      setInteractionError("创建会话失败：" + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setQuickCreatingId(null);
    }
  }

  function confirmDiscardEdit() {
    if (!edit) return true;
    const original = tree?.messages.find((message) => message.id === edit.messageId);
    return !messageEditHasChanges(edit, original) || window.confirm("放弃未保存的修改？");
  }

  function startEdit(message: Message) {
    if (!sessionId || edit?.messageId === message.id) return;
    if (!confirmDiscardEdit()) return;
    setEdit(sessionId, messageEditDraft(message));
  }

  function cancelEdit() {
    if (confirmDiscardEdit()) setEdit(sessionId, undefined);
  }

  async function saveEdit(message: Message, asNewSwipe = false) {
    if (!sessionId || !edit || pendingEdits.current.has(sessionId)) return;
    const submitted = edit;
    if (!asNewSwipe && submitted.value === message.content && submitted.thinkingValue === message.thinking_content) return;
    pendingEdits.current.add(sessionId);
    setSavingEditSessions((current) => ({ ...current, [sessionId]: true }));
    try {
      if (asNewSwipe) {
        await onCreateSwipe(message, submitted.value, submitted.thinkingValue);
      } else {
        await onUpdateMessage(message, submitted.value, submitted.thinkingValue);
      }
      if (useAppStore.getState().edits[sessionId] === submitted) setEdit(sessionId, undefined);
      setInteractionError(null);
    } catch (cause) {
      setInteractionError((asNewSwipe ? "保存新分支失败：" : "消息修改失败：") + (cause instanceof Error ? cause.message : String(cause)));
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
      setInteractionError("创建分支失败：" + (cause instanceof Error ? cause.message : String(cause)));
    }
  }

  async function performTreeAction(label: string, action: () => Promise<string>) {
    if (!sessionId || messageActionsBusy || pendingTreeActions.current.has(sessionId)) return;
    pendingTreeActions.current.add(sessionId);
    setTreeActionLabels((current) => ({ ...current, [sessionId]: label }));
    setTreeActionResults((current) => ({ ...current, [sessionId]: null }));
    setInteractionError(null);
    try {
      const result = await action();
      setTreeActionResults((current) => ({ ...current, [sessionId]: result }));
    } catch (cause) {
      setInteractionError(`${label}失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      pendingTreeActions.current.delete(sessionId);
      setTreeActionLabels((current) => ({ ...current, [sessionId]: null }));
    }
  }

  function deleteMessage(message: Message, scope: MessageDeleteScope) {
    if (messageActionsBusy) return;
    const description = scope === "swipe"
      ? "删除当前 swipe？\n\n将删除当前这条消息，以及从这条消息延伸的所有后续消息和分支。其他 swipe 会保留。\n\n此操作无法撤销。"
      : "删除一整层？\n\n将删除与当前消息共享同一条父消息的全部 swipe，以及这些 swipe 的所有后续消息和分支。若当前消息没有父消息，将删除会话内所有消息。\n\n此操作无法撤销。";
    if (!window.confirm(description)) return;
    void performTreeAction(scope === "swipe" ? "删除 swipe" : "删除一整层", async () => {
      const count = await onDeleteMessage(message, scope);
      return `已删除 ${count} 条消息。`;
    });
  }

  function pruneEmptyBranches() {
    if (messageActionsBusy || !tree?.messages.length) return;
    if (!window.confirm("清理当前会话的全部空白分支？\n\n只删除整棵子树中每条消息的正文和 Thinking 都为空或只有空白字符的分支。有正文或 Thinking 的消息及其上方路径会保留。\n\n此操作无法撤销。")) return;
    void performTreeAction("清理空白分支", async () => {
      const count = await onPruneEmptyBranches();
      return count ? `已清理空白分支，共删除 ${count} 条消息。` : "没有需要清理的空白分支。";
    });
  }

  function changeMessageRole(message: Message, role: Message["role"]) {
    void performTreeAction("切换消息角色", async () => {
      await onChangeMessageRole(message, role);
      return `消息已改为${role === "assistant" ? "角色" : role === "user" ? "用户" : "系统"}消息。`;
    });
  }

  return (
    <section className="chat-pane">
      <header className="chat-header">
        <div className="chat-header-start">
          <button className="icon-button" type="button" title="会话与资源" aria-label="会话与资源" aria-expanded={leftOpen} onClick={onToggleLeft}><Menu size={20} /></button>
        </div>
        <div className="session-title-block">
          <div className="session-header-identity">
            {character?.avatar_data_url && (
              <img className="chat-header-avatar" src={character.avatar_data_url} alt="" aria-hidden="true" />
            )}
            <div className="session-header-copy">
              <h2 title={activeSession?.title || "还没有会话"}>{activeSession?.title || "还没有会话"}</h2>
              {character && character.name !== activeSession?.title && <span className="session-header-subtitle">{character.name}</span>}
            </div>
          </div>
        </div>
        <div className="chat-actions">
          <button className="icon-button" type="button" title="当前路径分支与会话设置" aria-label="当前路径分支与会话设置" aria-expanded={rightOpen} onClick={onToggleRight}><PanelRight size={19} /></button>
          <button className="icon-button" type="button" title="浏览完整聊天树" aria-label="浏览完整聊天树" disabled={!tree} onClick={onOpenTree}><Network size={19} /></button>
          <ActionMenu label="会话操作">
            <button type="button" data-close-menu disabled={!tree?.messages.length || messageActionsBusy} onClick={pruneEmptyBranches}><Trash2 size={16} />一键清理空白分支</button>
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
          <div className="empty-state">
            <GitBranch size={32} />
            <p>未选择会话</p>
            <div className="empty-state-guide">
              {characters.length > 0 && onQuickCreateSession ? (
                <>
                  <span className="muted">点击角色立即开启新对话：</span>
                  <div className="quick-character-grid">
                    {characters.slice(0, 6).map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="secondary-button quick-character-btn"
                        disabled={quickCreatingId !== null}
                        onClick={() => void quickStartWithCharacter(item)}
                      >
                        <Plus size={14} />
                        <span>{quickCreatingId === item.id ? `正在创建 ${item.name}…` : `与 ${item.name} 对话`}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="inline-actions">
                  <button type="button" className="secondary-button" onClick={onToggleLeft}>
                    <Menu size={15} />
                    打开会话与角色面板
                  </button>
                  {onOpenSettings && (
                    <button type="button" className="secondary-button" onClick={onOpenSettings}>
                      <Settings size={15} />
                      配置模型连接
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {activeMessages.map((message) => {
          const siblings = siblingsFor(tree, message, messageIndex);
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
                <div className="message-meta"><strong>{message.speaker || message.role}</strong>{message.status !== "complete" && <span aria-live="polite">{presentation.statusLabel}</span>}</div>
                {message.thinking_content && (
                  <details className="thinking-box" open={message.status === "streaming"}>
                    <summary>Thinking · {message.thinking_token_count || "估算中"} tokens</summary>
                    <pre>{message.thinking_content}</pre>
                  </details>
                )}
                {isEditing ? (
                  <div className="editor-box">
                    <label className="form-field"><span>正文</span><AutoSizeTextarea disabled={messageActionsBusy} value={edit.value} onChange={(event) => setEdit(sessionId, { ...edit, value: event.target.value })} /></label>
                    {(message.role === "assistant" || message.thinking_content) && (
                      <label className="form-field"><span>Thinking</span><AutoSizeTextarea disabled={messageActionsBusy} value={edit.thinkingValue} onChange={(event) => setEdit(sessionId, { ...edit, thinkingValue: event.target.value })} /></label>
                    )}
                    <div className="inline-actions">
                      <button className="primary-button" type="button" disabled={messageActionsBusy || (edit.value === message.content && edit.thinkingValue === message.thinking_content)} onClick={() => void saveEdit(message)}>{savingEdit ? "保存中…" : "保存修改"}</button>
                      <button className="secondary-button" type="button" disabled={messageActionsBusy} onClick={() => void saveEdit(message, true)}>保存为新分支</button>
                      <button className="icon-button" type="button" title="取消" disabled={savingEdit} onClick={cancelEdit}><X size={16} /></button>
                    </div>
                  </div>
                ) : message.content ? (
                  <RegexMessage content={message.content} role={message.role} rules={regexRules} />
                ) : message.status === "streaming" ? <p className="message-content">…</p> : null}
                {message.error && <p className="message-error">{messageErrorText(message.error)}</p>}
                <footer className="message-footer">
                  {message.role === "assistant" && <small className="message-usage"
                    title={tokenDisplay.outputEstimated ? "根据已保存的正文和思考内容估算用量" : "模型服务返回的用量"}>
                    {inputTokens > 0 && <span>输入 {inputTokens}</span>}
                    <span>输出{tokenDisplay.outputEstimated ? "约 " : " "}{outputTokens || 0} tokens</span>
                    {cachedTokens > 0 && <span>缓存 {cachedTokens}</span>}
                    {speed > 0 && <span>{speed.toFixed(1)} tokens/s</span>}
                  </small>}
                  <div className="message-branch-actions" aria-label="分支切换">
                    <button className="icon-button" type="button" title="上一个分支" aria-label="上一个分支" disabled={!previous || mutating || Boolean(treeActionLabel)} onClick={() => previous && selectSwipeFromToolbar(previous.id)}><ChevronLeft size={16} /></button>
                    <span className="swipe-counter" aria-label={"第 " + (index + 1) + " 个，共 " + siblings.length + " 个分支"}>{index + 1}/{siblings.length}</span>
                    <button className="icon-button" type="button" title="下一个分支" aria-label="下一个分支" disabled={!next || mutating || Boolean(treeActionLabel)} onClick={() => next && selectSwipeFromToolbar(next.id)}><ChevronRight size={16} /></button>
                    <button className="icon-button message-quick-action" type="button" title="编辑消息" aria-label="编辑消息" disabled={messageActionsBusy} onClick={() => startEdit(message)}><Edit3 size={15} /></button>
                    {message.role === "assistant" && (
                      <button className="icon-button message-quick-action" type="button" title="重新生成此回复" aria-label="重新生成此回复" disabled={messageActionsBusy || !canGenerate} onClick={() => onRegenerate(message.id)}><RefreshCcw size={15} /></button>
                    )}
                    <ActionMenu label="消息操作">
                      <button type="button" data-close-menu disabled={!message.content} onClick={() => void copyMessage(message)}><Copy size={16} />复制正文</button>
                      {message.role === "assistant" && onReadMessage && <button type="button" data-close-menu disabled={messageActionsBusy || message.status !== "complete"} onClick={() => onReadMessage(message)}><Volume2 size={16} />朗读消息…</button>}
                      <button type="button" data-close-menu disabled={messageActionsBusy} onClick={() => void duplicateMessage(message)}><CopyPlus size={16} />复制为新分支</button>
                      <button type="button" data-close-menu disabled={messageActionsBusy} onClick={() => startEdit(message)}><Edit3 size={16} />编辑消息</button>
                      {message.role === "assistant" && <button type="button" data-close-menu disabled={messageActionsBusy || !canGenerate} onClick={() => onRegenerate(message.id)}><RefreshCcw size={16} />重新生成此回复</button>}
                      <div className="message-menu-divider" role="separator" />
                      {(["assistant", "user", "system"] as const).filter((role) => role !== message.role).map((role) => (
                        <button key={role} type="button" data-close-menu disabled={messageActionsBusy} onClick={() => changeMessageRole(message, role)}><UserRound size={16} />改为{role === "assistant" ? "角色" : role === "user" ? "用户" : "系统"}消息</button>
                      ))}
                      <div className="message-menu-divider" role="separator" />
                      <button className="message-menu-delete" type="button" data-close-menu disabled={messageActionsBusy} onClick={() => deleteMessage(message, "swipe")}><Trash2 size={16} />删除当前 swipe…</button>
                      <button className="message-menu-delete" type="button" data-close-menu disabled={messageActionsBusy} onClick={() => deleteMessage(message, "layer")}><Trash2 size={16} />删除一整层…</button>
                    </ActionMenu>
                  </div>
                </footer>
              </article>
            </div>
          );
        })}
      </div>

      <div className="composer-area">
        {ttsControls && <div className="tts-composer-controls">{ttsControls}</div>}
        {(treeActionLabel || mutating || treeActionResult) && <div className="chat-operation-status" role="status" aria-live="polite">
          {treeActionLabel || mutating ? <><LoaderCircle size={16} className="chat-operation-spinner" /><span>{treeActionLabel ? `${treeActionLabel}中…` : "正在更新会话…"}</span></> : <span>{treeActionResult}</span>}
          {!treeActionLabel && !mutating && <button className="icon-button" type="button" aria-label="关闭操作结果" onClick={() => setTreeActionResults((current) => ({ ...current, [sessionId]: null }))}><X size={14} /></button>}
        </div>}
        {(interactionError || loadError) && <div className="composer-error" role="alert">{interactionError || loadError}</div>}
        <div className="composer-tools">
          {modelPicker}
          <button className="secondary-button continue-generation" type="button" title="从当前路径继续生成回复" disabled={!tree || messageActionsBusy || !canGenerate} onClick={onGenerate}><Sparkles size={15} /><span>继续</span></button>
        </div>
        <form className="composer" onSubmit={(event) => void submit(event)}>
          <label className="composer-field"><span className="sr-only">发送消息</span><AutoSizeTextarea
              value={draft}
              onChange={(event) => sessionId && setDraft(sessionId, event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder={hasKeyboardShortcut ? "输入消息（Ctrl+Enter 发送）" : "输入消息"}
              disabled={!tree}
            /></label>
          {streaming ? (
            <button className="send-button composer-stop-button" type="button" title="停止生成" aria-label="停止生成" onClick={onStop}><Square size={17} /></button>
          ) : (
            <button className="send-button" disabled={!tree || !canGenerate || messageActionsBusy} title={draft.trim() ? "发送 (Ctrl+Enter)" : "空白发送：继续生成"} aria-label={draft.trim() ? "发送" : "空白发送：继续生成"}>{draft.trim() ? <Send size={18} /> : <Sparkles size={18} />}</button>
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
