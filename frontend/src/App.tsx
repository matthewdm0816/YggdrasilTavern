import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { api, ChatSession, Message, SessionTree, streamGenerate } from "./lib/api";
import { useAppStore } from "./state/useAppStore";
import { Sidebar } from "./components/Sidebar";
import { ChatPane } from "./components/ChatPane";
import { Inspector } from "./components/Inspector";

function upsertMessage(tree: SessionTree | undefined, message: Message): SessionTree | undefined {
  if (!tree) return tree;
  const exists = tree.messages.some((item) => item.id === message.id);
  const activeSiblingIndex = tree.active_path_ids.findIndex((id) => {
    const active = tree.messages.find((item) => item.id === id);
    return Boolean(active && active.parent_id === message.parent_id && active.id !== message.id);
  });
  const active_path_ids =
    activeSiblingIndex >= 0
      ? [...tree.active_path_ids.slice(0, activeSiblingIndex), message.id]
      : tree.active_path_ids.includes(message.id)
        ? tree.active_path_ids
        : [...tree.active_path_ids, message.id];
  return {
    ...tree,
    messages: exists ? tree.messages.map((item) => (item.id === message.id ? message : item)) : [...tree.messages, message],
    active_path_ids
  };
}

export default function App() {
  const queryClient = useQueryClient();
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const setSelectedSessionId = useAppStore((state) => state.setSelectedSessionId);
  const [tree, setTree] = useState<SessionTree | undefined>();
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profilesQuery = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const charactersQuery = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const worldbooksQuery = useQuery({ queryKey: ["worldbooks"], queryFn: api.worldbooks });
  const sessionsQuery = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });

  const treeQuery = useQuery({
    queryKey: ["tree", selectedSessionId],
    queryFn: () => api.tree(selectedSessionId!),
    enabled: Boolean(selectedSessionId)
  });

  useEffect(() => {
    if (!selectedSessionId && sessionsQuery.data?.length) {
      setSelectedSessionId(sessionsQuery.data[0].id);
    }
  }, [selectedSessionId, sessionsQuery.data, setSelectedSessionId]);

  useEffect(() => {
    if (treeQuery.data) setTree(treeQuery.data);
  }, [treeQuery.data]);

  const createSession = useMutation({
    mutationFn: api.createSession,
    onSuccess: async (session: ChatSession) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setSelectedSessionId(session.id);
    }
  });

  const activeSession = useMemo(
    () => sessionsQuery.data?.find((session) => session.id === selectedSessionId) || tree?.session,
    [sessionsQuery.data, selectedSessionId, tree]
  );

  async function reloadTree() {
    if (!selectedSessionId) return;
    const fresh = await api.tree(selectedSessionId);
    setTree(fresh);
    queryClient.setQueryData(["tree", selectedSessionId], fresh);
  }

  async function handleSend(content: string) {
    if (!selectedSessionId || !content.trim()) return;
    setError(null);
    await api.appendMessage(selectedSessionId, { role: "user", speaker: "User", content: content.trim(), status: "complete" });
    await reloadTree();
    await handleGenerate();
  }

  async function handleGenerate(regenerateMessageId?: string) {
    if (!selectedSessionId || streaming) return;
    setStreaming(true);
    setError(null);
    try {
      await streamGenerate(
        selectedSessionId,
        { regenerate_message_id: regenerateMessageId || null },
        {
          onCreated: (message) => setTree((current) => upsertMessage(current, message)),
          onToken: (messageId, delta) =>
            setTree((current) =>
              current
                ? {
                    ...current,
                    messages: current.messages.map((message) =>
                      message.id === messageId
                        ? { ...message, content: message.content + delta, status: "streaming", token_count: message.token_count + 1 }
                        : message
                    )
                  }
                : current
            ),
          onThinking: (messageId, delta) =>
            setTree((current) =>
              current
                ? {
                    ...current,
                    messages: current.messages.map((message) =>
                      message.id === messageId
                        ? {
                            ...message,
                            thinking_content: message.thinking_content + delta,
                            status: "streaming",
                            thinking_token_count: message.thinking_token_count + 1
                          }
                        : message
                    )
                  }
                : current
            ),
          onUsage: (messageId, usage) =>
            setTree((current) =>
              current
                ? {
                    ...current,
                    messages: current.messages.map((message) => (message.id === messageId ? { ...message, usage } : message))
                  }
                : current
            ),
          onComplete: (message) => setTree((current) => upsertMessage(current, message)),
          onError: (_, detail) => setError(detail)
        }
      );
      await reloadTree();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setStreaming(false);
    }
  }

  async function handleSelectMessage(messageId: string) {
    const next = await api.selectMessage(messageId);
    setTree(next);
    queryClient.setQueryData(["tree", selectedSessionId], next);
  }

  async function handleCreateSwipe(message: Message) {
    const next = await api.createSwipe(message.id, {
      role: message.role,
      speaker: message.speaker,
      content: message.content,
      thinking_content: message.thinking_content,
      status: "complete"
    });
    setTree(next);
  }

  async function handleUpdateMessage(messageId: string, content: string) {
    await api.updateMessage(messageId, { content });
    await reloadTree();
  }

  return (
    <main className="app-shell">
      <Sidebar
        profiles={profilesQuery.data || []}
        characters={charactersQuery.data || []}
        worldbooks={worldbooksQuery.data || []}
        sessions={sessionsQuery.data || []}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        onCreateSession={(payload) => createSession.mutate(payload)}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["profiles"] });
          queryClient.invalidateQueries({ queryKey: ["characters"] });
          queryClient.invalidateQueries({ queryKey: ["worldbooks"] });
          queryClient.invalidateQueries({ queryKey: ["sessions"] });
        }}
      />
      <ChatPane
        tree={tree}
        activeSession={activeSession}
        characters={charactersQuery.data || []}
        streaming={streaming}
        onSend={handleSend}
        onGenerate={() => handleGenerate()}
        onRegenerate={handleGenerate}
        onSelectMessage={handleSelectMessage}
        onCreateSwipe={handleCreateSwipe}
        onUpdateMessage={handleUpdateMessage}
      />
      <Inspector tree={tree} selectedSessionId={selectedSessionId} onSessionUpdated={reloadTree} />
      {error && (
        <div className="toast" role="alert">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}
    </main>
  );
}
