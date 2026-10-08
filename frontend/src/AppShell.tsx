import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, GitFork, Menu, X } from "lucide-react";
import { api, ChatSession } from "./lib/api";
import { useAppStore } from "./state/useAppStore";
import { useChatController } from "./features/chat/useChatController";
import { Sidebar } from "./components/Sidebar";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { WorkspaceInspector } from "./components/WorkspaceInspector";

type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "yggdrasil-tavern.theme";
const ACTIVE_PROFILE_STORAGE_KEY = "yggdrasil-tavern.active-api-profile";

function loadActiveProfileId(): string {
  try {
    return window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY) || "";
  } catch (cause) {
    console.error("Unable to read the active API Profile from localStorage.", cause);
    return "";
  }
}

function loadThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
    if (stored !== null) console.error("Ignoring invalid saved theme preference: " + stored);
  } catch (cause) {
    console.error("Unable to read the saved theme preference from localStorage.", cause);
  }
  return "system";
}

export default function AppShell() {
  const queryClient = useQueryClient();
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const setSelectedSessionId = useAppStore((state) => state.setSelectedSessionId);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"left" | "right" | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [themePreference, setThemePreference] = useState<ThemePreference>(loadThemePreference);
  const [activeProfileId, setActiveProfileId] = useState(loadActiveProfileId);

  const profilesQuery = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const charactersQuery = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const worldbooksQuery = useQuery({ queryKey: ["worldbooks"], queryFn: api.worldbooks });
  const sessionsQuery = useQuery({
    queryKey: ["sessions", showArchived],
    queryFn: () => api.sessions(showArchived ? { archived: true } : undefined)
  });
  const chat = useChatController({ selectedSessionId, activeProfileId });
  const tree = chat.tree;

  useEffect(() => {
    if (!selectedSessionId && sessionsQuery.data?.length) setSelectedSessionId(sessionsQuery.data[0].id);
  }, [selectedSessionId, sessionsQuery.data, setSelectedSessionId]);

  useEffect(() => {
    const profiles = profilesQuery.data;
    if (!profiles || profilesQuery.isFetching) return;
    if (!profiles.some((profile) => profile.id === activeProfileId)) {
      setActiveProfileId(profiles[0]?.id || "");
    }
  }, [activeProfileId, profilesQuery.data, profilesQuery.isFetching]);

  useEffect(() => {
    try {
      if (activeProfileId) window.localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, activeProfileId);
      else window.localStorage.removeItem(ACTIVE_PROFILE_STORAGE_KEY);
    } catch (cause) {
      console.error("Unable to persist the active API Profile to localStorage.", cause);
    }
  }, [activeProfileId]);

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
  const queryError = chat.treeQuery.error || sessionsQuery.error || profilesQuery.error || charactersQuery.error || worldbooksQuery.error;
  const displayedError = error || chat.error || (queryError instanceof Error ? queryError.message : queryError ? String(queryError) : null);
  const shellClass = [
    "app-shell",
    mobilePanel ? "mobile-panel-" + mobilePanel : "",
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
        activeProfileId={activeProfileId}
        onActiveProfileChange={setActiveProfileId}
        characters={charactersQuery.data || []}
        worldbooks={worldbooksQuery.data || []}
        sessions={sessionsQuery.data || []}
        selectedSessionId={selectedSessionId}
        showArchived={showArchived}
        creatingSession={createSession.isPending}
        createSessionError={createSession.error instanceof Error ? createSession.error.message : null}
        onSelectSession={(id) => { setSelectedSessionId(id); setMobilePanel(null); }}
        onCreateSession={(payload) => createSession.mutateAsync(payload)}
        onRefresh={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["profiles"] }),
            queryClient.invalidateQueries({ queryKey: ["characters"] }),
            queryClient.invalidateQueries({ queryKey: ["worldbooks"] }),
            queryClient.invalidateQueries({ queryKey: ["sessions"] }),
            queryClient.invalidateQueries({ queryKey: ["context-preview"] })
          ]);
        }}
        onToggleArchived={() => setShowArchived(!showArchived)}
        onCloseMobile={() => setMobilePanel(null)}
        onError={setError}
      />
      <ChatWorkspace
        tree={tree}
        activeSession={activeSession}
        characters={charactersQuery.data || []}
        loading={chat.treeQuery.isPending && Boolean(selectedSessionId)}
        loadError={chat.treeQuery.error instanceof Error ? chat.treeQuery.error.message : null}
        streaming={chat.streaming}
        onSend={chat.handleSend}
        onGenerate={() => chat.handleGenerate()}
        onStop={chat.stopGeneration}
        onRegenerate={chat.handleGenerate}
        onSelectMessage={chat.handleSelectMessage}
        onCreateSwipe={chat.handleCreateSwipe}
        onUpdateMessage={chat.handleUpdateMessage}
        onToggleLeft={() => setLeftCollapsed((value) => !value)}
        onToggleRight={() => setRightCollapsed((value) => !value)}
        themePreference={themePreference}
        onToggleTheme={() => setThemePreference((current) => current === "system" ? "light" : current === "light" ? "dark" : "system")}
      />
      <WorkspaceInspector
        tree={tree}
        selectedSessionId={selectedSessionId}
        activeProfileId={activeProfileId}
        worldbooks={worldbooksQuery.data || []}
        onSessionUpdated={() => chat.reloadTree()}
        onSelectMessage={chat.handleSelectMessage}
        onCloseMobile={() => setMobilePanel(null)}
        onError={setError}
      />
      {displayedError && (
        <div className="toast" role="alert">
          <AlertCircle size={16} />
          <span>{displayedError}</span>
          <button className="icon-button" aria-label="关闭错误" onClick={() => { setError(null); chat.clearError(); }}><X size={15} /></button>
        </div>
      )}
    </main>
  );
}
