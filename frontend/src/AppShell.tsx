import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, GitFork, Menu, X } from "lucide-react";
import { api, ChatSession, Message, SessionTree, streamGenerate } from "./lib/api";
import { useAppStore } from "./state/useAppStore";
import { Sidebar } from "./components/Sidebar";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { WorkspaceInspector } from "./components/WorkspaceInspector";

type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "yggdrasil-tavern.theme";

function loadThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    if (stored !== null) {
      console.error(`Ignoring invalid saved theme preference: ${stored}`);
    }
  } catch (cause) {
    console.error("Unable to read the saved theme preference from localStorage.", cause);
  }
  return "system";
}

function upsertMessage(tree: SessionTree | undefined, message: Message): SessionTree | undefined {
  if (!tree || tree.session.id !== message.session_id) return tree;
  const exists = tree.messages.some((item) => item.id === message.id);
  const activeSiblingIndex = tree.active_path_ids.findIndex((id) => {
    const active = tree.messages.find((item) => item.id === id);
    return Boolean(active && active.parent_id === message.parent_id && active.id !== message.id);
  });
  const activePath = activeSiblingIndex >= 0
    ? [...tree.active_path_ids.slice(0, activeSiblingIndex), message.id]
    : tree.active_path_ids.includes(message.id)
      ? tree.active_path_ids
      : [...tree.active_path_ids, message.id];
  return {
    ...tree,
    messages: exists ? tree.messages.map((item) => (item.id === message.id ? message : item)) : [...tree.messages, message],
    active_path_ids: activePath
  };
}

export default function AppShell() {
  const queryClient = useQueryClient();
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const setSelectedSessionId = useAppStore((state) => state.setSelectedSessionId);
  const [streamingBySession, setStreamingBySession] = useState<Record<string, boolean>>({});
  const streamingSessions = useRef(new Set<string>());
  const abortControllers = useRef(new Map<string, AbortController>());
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"left" | "right" | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);

  const profilesQuery = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const charactersQuery = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const worldbooksQuery = useQuery({ queryKey: ["worldbooks"], queryFn: api.worldbooks });
  const sessionsQuery = useQuery({
    queryKey: ["sessions", showArchived],
    queryFn: () => api.sessions(showArchived ? { archived: true } : undefined)
  });
  const treeQuery = useQuery({
    queryKey: ["tree", selectedSessionId],
    queryFn: () => api.tree(selectedSessionId!),
    enabled: Boolean(selectedSessionId),
    retry: 1
  });
  const tree = treeQuery.data;

  useEffect(() => {
    if (!selectedSessionId && sessionsQuery.data?.length) setSelectedSessionId(sessionsQuery.data[0].id);
  }, [selectedSessionId, sessionsQuery.data, setSelectedSessionId]);

  useLayoutEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = themePreference === "system"
        ? (systemTheme.matches ? "dark" : "light")
        : themePreference;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.style.colorScheme = resolvedTheme;
    };

    applyTheme();
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch (cause) {
      console.error("Unable to persist the selected theme preference to localStorage.", cause);
    }

    if (themePreference !== "system") return undefined;
    systemTheme.addEventListener("change", applyTheme);
    return () => systemTheme.removeEventListener("change", applyTheme);
  }, [themePreference]);

  useEffect(() => () => {
    abortControllers.current.forEach((controller) => controller.abort());
  }, []);

  const createSession = useMutation({
    mutationFn: api.createSession,
    onMutate: () => setError(null),
    onSuccess: async (session: ChatSession) => {
      queryClient.setQueryData<ChatSession[]>(["sessions", showArchived], (current) => current ? [session, ...current] : [session]);
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setSelectedSessionId(session.id);
      setMobilePanel(null);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause))
  });

  const activeSession = useMemo(
    () => tree?.session || sessionsQuery.data?.find((session) => session.id === selectedSessionId),
    [sessionsQuery.data, selectedSessionId, tree]
  );

  function setSessionStreaming(sessionId: string, value: boolean) {
    setStreamingBySession((current) => ({ ...current, [sessionId]: value }));
  }

  function updateTree(sessionId: string, updater: (tree: SessionTree | undefined) => SessionTree | undefined) {
    queryClient.setQueryData<SessionTree | undefined>(["tree", sessionId], updater);
  }

  async function reloadTree(sessionIdOverride?: string) {
    const sessionId = sessionIdOverride || selectedSessionId;
    if (!sessionId) return;
    const fresh = await api.tree(sessionId);
    queryClient.setQueryData(["tree", sessionId], fresh);
  }

  async function reloadTreeWhenTerminal(sessionId: string, messageId: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const fresh = await api.tree(sessionId);
      const generated = fresh.messages.find((message) => message.id === messageId);
      if (!generated || generated.status !== "streaming") {
        queryClient.setQueryData(["tree", sessionId], fresh);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    // Preserve the fuller client-side partial instead of overwriting it with an
    // older batch commit. A later refetch reconciles once cancellation persists.
    setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["tree", sessionId] }), 1000);
  }

  async function handleSend(content: string) {
    const sessionId = selectedSessionId;
    if (!sessionId || !content.trim()) return;
    setError(null);
    await api.appendMessage(sessionId, { role: "user", speaker: "User", content: content.trim(), status: "complete" });
    await reloadTree(sessionId);
    void handleGenerate(undefined, sessionId);
  }

  async function handleGenerate(regenerateMessageId?: string, sessionIdOverride?: string) {
    const sessionId = sessionIdOverride || selectedSessionId;
    if (!sessionId || streamingSessions.current.has(sessionId)) return;
    const controller = new AbortController();
    streamingSessions.current.add(sessionId);
    abortControllers.current.set(sessionId, controller);
    setSessionStreaming(sessionId, true);
    setError(null);
    let generatedMessageId: string | undefined;
    try {
      await streamGenerate(sessionId, { regenerate_message_id: regenerateMessageId || null }, {
        onCreated: (message) => {
          generatedMessageId = message.id;
          updateTree(sessionId, (current) => upsertMessage(current, message));
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
        onComplete: (message) => updateTree(sessionId, (current) => upsertMessage(current, message)),
        onError: (_, detail) => setError(detail)
      }, controller.signal);
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      try {
        if (controller.signal.aborted && generatedMessageId) {
          await reloadTreeWhenTerminal(sessionId, generatedMessageId);
        } else {
          await reloadTree(sessionId);
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      streamingSessions.current.delete(sessionId);
      abortControllers.current.delete(sessionId);
      setSessionStreaming(sessionId, false);
    }
  }

  function stopGeneration() {
    if (selectedSessionId) abortControllers.current.get(selectedSessionId)?.abort();
  }

  async function handleSelectMessage(messageId: string) {
    const sessionId = selectedSessionId;
    if (!sessionId) return;
    const next = await api.selectMessage(messageId);
    if (next.session.id === sessionId) queryClient.setQueryData(["tree", sessionId], next);
  }

  async function handleCreateSwipe(message: Message, content = message.content) {
    const next = await api.createSwipe(message.id, {
      role: message.role,
      speaker: message.speaker,
      content,
      thinking_content: message.thinking_content,
      status: "complete"
    });
    queryClient.setQueryData(["tree", message.session_id], next);
  }

  async function handleForkEdit(message: Message, content: string) {
    await handleCreateSwipe(message, content);
  }

  const queryError = treeQuery.error || sessionsQuery.error || profilesQuery.error || charactersQuery.error || worldbooksQuery.error;
  const shellClass = [
    "app-shell",
    mobilePanel ? `mobile-panel-${mobilePanel}` : "",
    leftCollapsed ? "left-collapsed" : "",
    rightCollapsed ? "right-collapsed" : ""
  ].filter(Boolean).join(" ");

  return (
    <main className={shellClass}>
      <nav className="mobile-toolbar" aria-label="移动端面板">
        <button className="icon-button" aria-label="打开会话与资源" onClick={() => setMobilePanel(mobilePanel === "left" ? null : "left")}><Menu size={20} /></button>
        <strong>{activeSession?.title || "YggdrasilTavern"}</strong>
        <button className="icon-button" aria-label="打开分支与 Prompt" onClick={() => setMobilePanel(mobilePanel === "right" ? null : "right")}><GitFork size={20} /></button>
      </nav>
      {mobilePanel && <button className="mobile-scrim" aria-label="关闭面板" onClick={() => setMobilePanel(null)} />}
      <Sidebar
        profiles={profilesQuery.data || []}
        characters={charactersQuery.data || []}
        worldbooks={worldbooksQuery.data || []}
        sessions={sessionsQuery.data || []}
        selectedSessionId={selectedSessionId}
        showArchived={showArchived}
        creatingSession={createSession.isPending}
        createSessionError={createSession.error instanceof Error ? createSession.error.message : null}
        onSelectSession={(id) => { setSelectedSessionId(id); setMobilePanel(null); }}
        onCreateSession={(payload) => createSession.mutateAsync(payload)}
        onRefresh={() => {
          queryClient.invalidateQueries({ queryKey: ["profiles"] });
          queryClient.invalidateQueries({ queryKey: ["characters"] });
          queryClient.invalidateQueries({ queryKey: ["worldbooks"] });
          queryClient.invalidateQueries({ queryKey: ["sessions"] });
        }}
        onToggleArchived={() => setShowArchived(!showArchived)}
        onCloseMobile={() => setMobilePanel(null)}
        onError={setError}
      />
      <ChatWorkspace
        tree={tree}
        activeSession={activeSession}
        characters={charactersQuery.data || []}
        loading={treeQuery.isPending && Boolean(selectedSessionId)}
        loadError={treeQuery.error instanceof Error ? treeQuery.error.message : null}
        streaming={Boolean(selectedSessionId && streamingBySession[selectedSessionId])}
        onSend={handleSend}
        onGenerate={() => handleGenerate()}
        onStop={stopGeneration}
        onRegenerate={handleGenerate}
        onSelectMessage={handleSelectMessage}
        onCreateSwipe={handleCreateSwipe}
        onForkEdit={handleForkEdit}
        onToggleLeft={() => setLeftCollapsed((value) => !value)}
        onToggleRight={() => setRightCollapsed((value) => !value)}
        themePreference={themePreference}
        onToggleTheme={() => setThemePreference((current) => current === "system" ? "light" : current === "light" ? "dark" : "system")}
      />
      <WorkspaceInspector
        tree={tree}
        selectedSessionId={selectedSessionId}
        worldbooks={worldbooksQuery.data || []}
        onSessionUpdated={() => reloadTree()}
        onSelectMessage={handleSelectMessage}
        onCloseMobile={() => setMobilePanel(null)}
        onError={setError}
      />
      {(error || queryError) && (
        <div className="toast" role="alert">
          <AlertCircle size={16} />
          <span>{error || (queryError instanceof Error ? queryError.message : String(queryError))}</span>
          <button className="icon-button" aria-label="关闭错误" onClick={() => setError(null)}><X size={15} /></button>
        </div>
      )}
    </main>
  );
}
