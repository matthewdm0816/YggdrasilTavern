import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, Message, MessageDeleteScope, SessionTree, streamGenerate } from "../../lib/api";
import { loadTreeSnapshot, reconcileTreeSnapshot, treeQueryKey, upsertTreeMessage } from "./treeCache";
import { SessionGenerationRegistry } from "./SessionGenerationRegistry";
import { SessionSelectionQueue } from "./SessionSelectionQueue";
import { SessionTreeEpoch } from "./SessionTreeEpoch";

type ChatControllerOptions = {
  selectedSessionId: string | null;
  activeProfileId: string;
  onMessageCompleted?: (message: Message) => void;
};

function errorDetail(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function useChatController({ selectedSessionId, activeProfileId, onMessageCompleted }: ChatControllerOptions) {
  const queryClient = useQueryClient();
  const completedCallback = useRef(onMessageCompleted);
  completedCallback.current = onMessageCompleted;
  const [streamingBySession, setStreamingBySession] = useState<Record<string, boolean>>({});
  const [errorsBySession, setErrorsBySession] = useState<Record<string, string | null>>({});
  const [mutatingBySession, setMutatingBySession] = useState<Record<string, boolean>>({});
  const generations = useRef(new SessionGenerationRegistry());
  const selections = useRef(new SessionSelectionQueue());
  const epochs = useRef(new SessionTreeEpoch());
  const pendingSends = useRef(new Set<string>());
  const pendingMutations = useRef(new Map<string, number>());

  const treeQuery = useQuery({
    queryKey: ["tree", selectedSessionId],
    queryFn: ({ signal }) => loadTreeSnapshot(
      queryClient,
      selectedSessionId!,
      () => api.tree(selectedSessionId!),
      epochs.current,
      signal
    ),
    enabled: Boolean(selectedSessionId),
    retry: 1
  });

  useEffect(() => () => {
    generations.current.abortAll();
  }, []);

  function setSessionError(sessionId: string, detail: string | null) {
    setErrorsBySession((current) => ({ ...current, [sessionId]: detail }));
  }

  function setSessionStreaming(sessionId: string, value: boolean) {
    setStreamingBySession((current) => ({ ...current, [sessionId]: value }));
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
    if (pendingSends.current.has(sessionId) || generations.current.isActive(sessionId)) return;
    if (pendingMutations.current.has(sessionId)) throw new Error("正在更新会话，请稍后发送。");
    if (!content.trim()) {
      void handleGenerate(undefined, sessionId);
      return;
    }
    pendingSends.current.add(sessionId);
    setSessionError(sessionId, null);
    try {
      epochs.current.advance(sessionId);
      await api.appendMessage(sessionId, { role: "user", speaker: "User", content: content.trim(), status: "complete" });
      epochs.current.advance(sessionId);
      await reloadTree(sessionId);
      void handleGenerate(undefined, sessionId);
    } finally {
      pendingSends.current.delete(sessionId);
    }
  }

  async function handleGenerate(regenerateMessageId?: string, sessionIdOverride?: string) {
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
    const controller = generations.current.begin(sessionId);
    if (!controller) return;
    setSessionStreaming(sessionId, true);
    setSessionError(sessionId, null);
    let generatedMessageId: string | undefined;
    try {
      await streamGenerate(sessionId, {
        regenerate_message_id: regenerateMessageId || null,
        api_profile_id: activeProfileId
      }, {
        onCreated: (message) => {
          generatedMessageId = message.id;
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
      generations.current.finish(sessionId, controller);
      setSessionStreaming(sessionId, false);
    }
  }

  function stopGeneration() {
    if (selectedSessionId) generations.current.stop(selectedSessionId);
  }

  async function handleSelectMessage(messageId: string) {
    const sessionId = selectedSessionId;
    if (!sessionId) return;
    await mutateTree(sessionId, () => api.selectMessage(messageId), true);
  }

  async function handleCreateSwipe(message: Message, content = message.content, thinkingContent = message.thinking_content) {
    const sessionId = message.session_id;
    await mutateTree(sessionId, () => api.createSwipe(message.id, {
      role: message.role,
      speaker: message.speaker,
      content,
      thinking_content: thinkingContent,
      status: "complete"
    }));
  }

  async function handleUpdateMessage(message: Message, content: string, thinkingContent: string) {
    const sessionId = message.session_id;
    await mutateTree(sessionId, async () => {
      await api.updateMessage(message.id, { content, thinking_content: thinkingContent });
      return api.tree(sessionId);
    });
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
    streaming: Boolean(selectedSessionId && streamingBySession[selectedSessionId]),
    mutating: Boolean(selectedSessionId && mutatingBySession[selectedSessionId]),
    error: selectedSessionId ? errorsBySession[selectedSessionId] : null,
    clearError: () => selectedSessionId && setSessionError(selectedSessionId, null),
    reloadTree,
    handleSend,
    handleGenerate,
    stopGeneration,
    handleSelectMessage,
    handleCreateSwipe,
    handleUpdateMessage,
    handleChangeMessageRole,
    handleDeleteMessage,
    handlePruneEmptyBranches
  };
}
