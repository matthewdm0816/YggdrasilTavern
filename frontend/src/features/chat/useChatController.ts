import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Message, MessageDeleteScope, SessionTree, streamGenerate } from "../../lib/api";
import { loadTreeSnapshot, reconcileTreeSnapshot, treeQueryKey, upsertTreeMessage } from "./treeCache";
import { ActiveGeneration, GenerationRegistry, generationExcerpt } from "./GenerationRegistry";
import { SessionSelectionQueue } from "./SessionSelectionQueue";
import { SessionTreeEpoch } from "./SessionTreeEpoch";

type ChatControllerOptions = {
  selectedSessionId: string | null;
  activeProfileId: string;
  /** Most generations this page may run at once, across all sessions. */
  generationLimit: number;
  onMessageCompleted?: (message: Message) => void;
};

type GenerateOptions = {
  regenerateMessageId?: string;
  /** Reply below this message; defaults to the end of the displayed path. */
  parentMessageId?: string | null;
  sessionId?: string;
};

/** A reply that finished while it was not on the displayed path. */
export type UnreadGeneration = {
  sessionId: string;
  messageId: string;
  status: Message["status"];
  label: string;
};

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function generationLimitMessage(limit: number): string {
  return `同时生成已达上限（${limit} 个）。请等其中一个完成或停止后再试，也可以在“设置”里调高上限。`;
}

/** The last message on the displayed path, or null for an empty session. */
export function pathEndId(tree: SessionTree | undefined): string | null {
  const ids = tree?.active_path_ids;
  return ids?.length ? ids[ids.length - 1] : null;
}

/** The running generation at the end of the displayed path, including one whose reply is not created yet. */
export function pathEndGeneration(tree: SessionTree | undefined, active: ActiveGeneration[]): ActiveGeneration | undefined {
  if (!tree) return undefined;
  const leafId = pathEndId(tree);
  return active.find((item) => item.sessionId === tree.session.id
    && (leafId !== null && item.messageId === leafId || item.messageId === null && item.parentId === leafId));
}

export function useChatController({ selectedSessionId, activeProfileId, generationLimit, onMessageCompleted }: ChatControllerOptions) {
  const queryClient = useQueryClient();
  const completedCallback = useRef(onMessageCompleted);
  completedCallback.current = onMessageCompleted;
  const [errorsBySession, setErrorsBySession] = useState<Record<string, string | null>>({});
  const [mutatingBySession, setMutatingBySession] = useState<Record<string, boolean>>({});
  const [activeGenerations, setActiveGenerations] = useState<ActiveGeneration[]>([]);
  const [unreadGenerations, setUnreadGenerations] = useState<UnreadGeneration[]>([]);
  const selectedSessionRef = useRef(selectedSessionId);
  selectedSessionRef.current = selectedSessionId;
  const generations = useRef(new GenerationRegistry());
  const selections = useRef(new SessionSelectionQueue());
  const epochs = useRef(new SessionTreeEpoch());
  const pendingSends = useRef(new Set<string>());
  const pendingMutations = useRef(new Map<string, number>());

  const treeQuery = useQuery({
    queryKey: ["tree", selectedSessionId],
    queryFn: ({ signal }) => loadTreeSnapshot(
      queryClient,
      selectedSessionId!,
      () => api.tree(selectedSessionId!, signal),
      epochs.current,
      signal
    ),
    enabled: Boolean(selectedSessionId),
    retry: 1
  });

  useEffect(() => () => {
    generations.current.abortAll();
  }, []);

  // A reply counts as read once it is on the displayed path of the selected session.
  useEffect(() => {
    const path = treeQuery.data?.active_path_ids;
    if (!selectedSessionId || !path) return;
    setUnreadGenerations((current) => {
      const next = current.filter((item) => !(item.sessionId === selectedSessionId && path.includes(item.messageId)));
      return next.length === current.length ? current : next;
    });
  }, [selectedSessionId, treeQuery.data]);

  function setSessionError(sessionId: string, detail: string | null) {
    setErrorsBySession((current) => ({ ...current, [sessionId]: detail }));
  }

  function publishGenerations() {
    setActiveGenerations(generations.current.list());
  }

  function cachedTree(sessionId: string) {
    return queryClient.getQueryData<SessionTree>(treeQueryKey(sessionId));
  }

  function markUnreadIfHidden(sessionId: string, messageId: string) {
    const tree = cachedTree(sessionId);
    const message = tree?.messages.find((item) => item.id === messageId);
    if (!message) return;
    if (selectedSessionRef.current === sessionId && tree?.active_path_ids.includes(messageId)) return;
    setUnreadGenerations((current) => [
      ...current.filter((item) => item.messageId !== messageId),
      { sessionId, messageId, status: message.status, label: generationExcerpt(message.content || message.error) }
    ]);
  }

  function updateTree(sessionId: string, updater: (tree: SessionTree | undefined) => SessionTree | undefined) {
    queryClient.setQueryData<SessionTree | undefined>(treeQueryKey(sessionId), updater);
  }

  async function mutateTree(sessionId: string, request: () => Promise<SessionTree>, allowStreaming = false) {
    const assertIdle = () => {
      const cached = queryClient.getQueryData<SessionTree>(treeQueryKey(sessionId));
      if (!allowStreaming && (pendingSends.current.has(sessionId) || generations.current.isActive(sessionId)
        || cached?.messages.some((message) => message.status === "streaming"))) {
        throw new Error("请先停止当前会话的生成，再修改消息或删除分支。");
      }
    };
    assertIdle();
    pendingMutations.current.set(sessionId, (pendingMutations.current.get(sessionId) || 0) + 1);
    setMutatingBySession((current) => ({ ...current, [sessionId]: true }));
    epochs.current.advance(sessionId);
    try {
      await selections.current.run(sessionId, async () => {
        assertIdle();
        await queryClient.cancelQueries({ queryKey: treeQueryKey(sessionId), exact: true });
        return request();
      }, (next) => {
        epochs.current.advance(sessionId);
        reconcileTreeSnapshot(queryClient, next, { authoritative: !allowStreaming });
      }, !allowStreaming);
      await queryClient.invalidateQueries({ queryKey: ["context-preview", sessionId] });
    } finally {
      const count = (pendingMutations.current.get(sessionId) || 1) - 1;
      if (count) pendingMutations.current.set(sessionId, count);
      else pendingMutations.current.delete(sessionId);
      setMutatingBySession((current) => ({ ...current, [sessionId]: count > 0 }));
    }
  }

  async function reloadTree(sessionIdOverride?: string) {
    const sessionId = sessionIdOverride || selectedSessionId;
    if (!sessionId) return;
    const fresh = await loadTreeSnapshot(queryClient, sessionId, () => api.tree(sessionId), epochs.current);
    queryClient.setQueryData(treeQueryKey(sessionId), fresh);
  }

  async function reloadTreeWhenTerminal(sessionId: string, messageId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const revision = epochs.current.capture(sessionId);
      const fresh = await api.tree(sessionId);
      if (!epochs.current.isCurrent(sessionId, revision)) {
        await reloadTree(sessionId);
        return;
      }
      const generated = fresh.messages.find((message) => message.id === messageId);
      if (generated && generated.status !== "streaming") {
        reconcileTreeSnapshot(queryClient, fresh);
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    }
    // A later refetch reconciles after cancellation is persisted by the server.
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: treeQueryKey(sessionId) }).catch((cause) => {
        setSessionError(sessionId, errorDetail(cause));
      });
    }, 1000);
  }

  async function handleSend(content: string) {
    const sessionId = selectedSessionId;
    if (!sessionId) return;
    if (!activeProfileId) {
      throw new Error("请先在左侧 API 设置中选择或新建一组 API 配置");
    }
    if (pendingSends.current.has(sessionId)) return;
    if (pendingMutations.current.has(sessionId)) throw new Error("正在更新会话，请稍后发送。");
    const tree = cachedTree(sessionId);
    const leafId = pathEndId(tree);
    const leaf = tree?.messages.find((message) => message.id === leafId);
    if (leaf?.status === "streaming" || pathEndGeneration(tree, generations.current.list())) {
      throw new Error("这条回复还在生成，请等它完成，或切到别的分支再发送。");
    }
    if (generations.current.size >= generationLimit) throw new Error(generationLimitMessage(generationLimit));
    if (!content.trim()) {
      void handleGenerate({ parentMessageId: leafId, sessionId });
      return;
    }
    pendingSends.current.add(sessionId);
    setSessionError(sessionId, null);
    try {
      epochs.current.advance(sessionId);
      const prompt = await api.appendMessage(sessionId, {
        role: "user", speaker: "User", content: content.trim(), status: "complete", parent_id: leafId
      });
      epochs.current.advance(sessionId);
      await reloadTree(sessionId);
      void handleGenerate({ parentMessageId: prompt.id, sessionId });
    } finally {
      pendingSends.current.delete(sessionId);
    }
  }

  async function handleGenerate({ regenerateMessageId, parentMessageId, sessionId: sessionIdOverride }: GenerateOptions = {}) {
    const sessionId = sessionIdOverride || selectedSessionId;
    if (!sessionId) return;
    if (pendingMutations.current.has(sessionId)) {
      setSessionError(sessionId, "正在更新会话，请稍后生成。");
      return;
    }
    if (!activeProfileId) {
      setSessionError(sessionId, "请先在 API Profiles 中选择或新建一个当前 Profile");
      return;
    }
    if (generations.current.size >= generationLimit) {
      setSessionError(sessionId, generationLimitMessage(generationLimit));
      return;
    }
    const tree = cachedTree(sessionId);
    // Name the parent explicitly so a branch switch elsewhere cannot move where this reply lands.
    const parentId = regenerateMessageId
      ? tree?.messages.find((message) => message.id === regenerateMessageId)?.parent_id ?? null
      : parentMessageId !== undefined ? parentMessageId : pathEndId(tree);
    const { key, controller } = generations.current.begin({
      sessionId,
      parentId,
      label: generationExcerpt(tree?.messages.find((message) => message.id === parentId)?.content)
    });
    publishGenerations();
    setSessionError(sessionId, null);
    let generatedMessageId: string | undefined;
    try {
      await streamGenerate(sessionId, {
        regenerate_message_id: regenerateMessageId || null,
        parent_message_id: regenerateMessageId ? null : parentId,
        api_profile_id: activeProfileId
      }, {
        onCreated: (message) => {
          generatedMessageId = message.id;
          generations.current.attach(key, message.id);
          publishGenerations();
          epochs.current.advance(sessionId);
          updateTree(sessionId, (current) => upsertTreeMessage(current, message));
        },
        onToken: (messageId, delta) => updateTree(sessionId, (current) => current ? {
          ...current,
          messages: current.messages.map((message) => message.id === messageId
            ? { ...message, content: message.content + delta, status: "streaming" }
            : message)
        } : current),
        onThinking: (messageId, delta) => updateTree(sessionId, (current) => current ? {
          ...current,
          messages: current.messages.map((message) => message.id === messageId
            ? { ...message, thinking_content: message.thinking_content + delta, status: "streaming" }
            : message)
        } : current),
        onUsage: (messageId, usage) => updateTree(sessionId, (current) => current ? {
          ...current,
          messages: current.messages.map((message) => message.id === messageId ? { ...message, usage } : message)
        } : current),
        onComplete: (message) => {
          epochs.current.advance(sessionId);
          updateTree(sessionId, (current) => upsertTreeMessage(current, message, false));
          completedCallback.current?.(message);
        },
        onError: (_, detail) => setSessionError(sessionId, detail)
      }, controller.signal);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setSessionError(sessionId, errorDetail(cause));
      }
    } finally {
      try {
        if (controller.signal.aborted && generatedMessageId) {
          await reloadTreeWhenTerminal(sessionId, generatedMessageId);
        } else {
          await reloadTree(sessionId);
        }
      } catch (cause) {
        setSessionError(sessionId, errorDetail(cause));
      }
      generations.current.finish(key);
      publishGenerations();
      // A reply the user stopped is not news; one that finished out of sight is.
      if (generatedMessageId && !controller.signal.aborted) markUnreadIfHidden(sessionId, generatedMessageId);
    }
  }

  function stopGeneration(key: string) {
    generations.current.stop(key);
  }

  function dismissUnread(messageId: string) {
    setUnreadGenerations((current) => current.filter((item) => item.messageId !== messageId));
  }

  async function handleSelectMessageInSession(sessionId: string, messageId: string) {
    await mutateTree(sessionId, () => api.selectMessage(messageId), true);
  }

  async function handleSelectMessage(messageId: string) {
    const sessionId = selectedSessionId;
    if (!sessionId) return;
    await handleSelectMessageInSession(sessionId, messageId);
  }

  // Edits and new branches delete nothing, so they may run beside a stream; the server rejects edits to the streaming message itself.
  async function handleCreateSwipe(message: Message, content = message.content, thinkingContent = message.thinking_content) {
    const sessionId = message.session_id;
    await mutateTree(sessionId, () => api.createSwipe(message.id, {
      role: message.role,
      speaker: message.speaker,
      content,
      thinking_content: thinkingContent,
      status: "complete"
    }), true);
  }

  async function handleUpdateMessage(message: Message, content: string, thinkingContent: string) {
    const sessionId = message.session_id;
    await mutateTree(sessionId, async () => {
      await api.updateMessage(message.id, { content, thinking_content: thinkingContent });
      return api.tree(sessionId);
    }, true);
  }

  async function handleChangeMessageRole(message: Message, role: Message["role"]) {
    await mutateTree(message.session_id, async () => {
      await api.updateMessage(message.id, { role });
      return api.tree(message.session_id);
    });
  }

  async function handleDeleteMessage(message: Message, scope: MessageDeleteScope) {
    let deletedCount = 0;
    await mutateTree(message.session_id, async () => {
      const next = await api.deleteMessage(message.id, scope);
      deletedCount = next.deleted_count;
      return next;
    });
    return deletedCount;
  }

  async function handlePruneEmptyBranches() {
    if (!selectedSessionId) return 0;
    const sessionId = selectedSessionId;
    let deletedCount = 0;
    await mutateTree(sessionId, async () => {
      const next = await api.pruneEmptyBranches(sessionId);
      deletedCount = next.deleted_count;
      return next;
    });
    return deletedCount;
  }

  return {
    treeQuery,
    tree: treeQuery.data,
    // True while any reply in the selected session streams; deletion and role changes wait for all of them.
    streaming: activeGenerations.some((item) => item.sessionId === selectedSessionId),
    activeGenerations,
    unreadGenerations,
    dismissUnread,
    mutating: Boolean(selectedSessionId && mutatingBySession[selectedSessionId]),
    error: selectedSessionId ? errorsBySession[selectedSessionId] : null,
    clearError: () => selectedSessionId && setSessionError(selectedSessionId, null),
    reloadTree,
    handleSend,
    handleGenerate,
    stopGeneration,
    handleSelectMessage,
    handleSelectMessageInSession,
    handleCreateSwipe,
    handleUpdateMessage,
    handleChangeMessageRole,
    handleDeleteMessage,
    handlePruneEmptyBranches
  };
}
