import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, X } from "lucide-react";
import { api, APIProfile, ChatSession } from "./lib/api";
import { useAppStore } from "./state/useAppStore";
import { useChatController } from "./features/chat/useChatController";
import { Sidebar } from "./components/Sidebar";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { WorkspaceInspector } from "./components/WorkspaceInspector";
import { ModelPicker } from "./components/ModelPicker";
import { useMediaQuery } from "./lib/useMediaQuery";
import { useTheme } from "./features/theme";

const ACTIVE_PROFILE_STORAGE_KEY = "yggdrasil-tavern.active-api-profile";

function loadActiveProfileId(): string {
  try {
    return window.localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY) || "";
  } catch (cause) {
    console.error("Unable to read the active API Profile from localStorage.", cause);
    return "";
  }
}

export default function AppShell() {
  const queryClient = useQueryClient();
  const selectedSessionId = useAppStore((state) => state.selectedSessionId);
  const setSelectedSessionId = useAppStore((state) => state.setSelectedSessionId);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"left" | "right" | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const isMobile = useMediaQuery("(max-width: 920px)");
  const isWide = useMediaQuery("(min-width: 1440px)");
  const [rightPreference, setRightPreference] = useState<boolean | null>(null);
  const rightOpen = rightPreference ?? isWide;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const modelChanging = pickerBusy || settingsBusy;
  const [treeViewOpen, setTreeViewOpen] = useState(false);
  const theme = useTheme();
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

  useEffect(() => { setMobilePanel(null); }, [isMobile]);

  const drawer = isMobile ? mobilePanel : !isWide && rightOpen ? "right" : null;
  useEffect(() => {
    if (!drawer) return;
    const pane = document.querySelector<HTMLElement>(drawer === "left" ? ".left-pane" : ".right-pane");
    const previous = document.activeElement as HTMLElement | null;
    const getFocusable = () => Array.from(pane?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']") || [])
      .filter((element) => element.getClientRects().length > 0);
    const frame = requestAnimationFrame(() => getFocusable()[0]?.focus());
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (document.querySelector("dialog[open], .action-menu, .forest-tree-dialog")) return;
        if (isMobile) setMobilePanel(null); else setRightPreference(false);
      }
      if (event.key === "Tab" && !document.querySelector("dialog[open], .action-menu, .forest-tree-dialog")) {
        const items = getFocusable();
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("keydown", keyboard); previous?.focus(); };
  }, [drawer, isMobile]);

  const profileUpdated = (profile: APIProfile) => {
    queryClient.setQueryData<APIProfile[]>(["profiles"], (current) => current?.some((item) => item.id === profile.id)
      ? current.map((item) => item.id === profile.id ? profile : item) : [...(current || []), profile]);
  };

  const openSettings = () => { setMobilePanel(null); setSettingsOpen(true); };
  const openTree = useCallback(() => { setMobilePanel(null); setTreeViewOpen(true); }, []);
  const closeTree = useCallback(() => setTreeViewOpen(false), []);
  const closeInspector = () => { setMobilePanel(null); setRightPreference(false); };

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
    !rightOpen ? "right-collapsed" : "",
    !isMobile && !isWide && rightOpen ? "inspector-overlay" : ""
  ].filter(Boolean).join(" ");

  return (
    <main className={shellClass}>
      {drawer && <button className="workspace-scrim" aria-label="关闭面板" onClick={() => { setMobilePanel(null); if (!isMobile) setRightPreference(false); }} />}
      <Sidebar
        onBusyChange={setSettingsBusy}
        onProfileUpdated={profileUpdated}
        settingsOpen={settingsOpen}
        onCloseSettings={() => setSettingsOpen(false)}
        onOpenSettings={openSettings}
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
        onCloseMobile={() => { setMobilePanel(null); if (!isMobile) setLeftCollapsed(true); }}
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
        onToggleLeft={() => isMobile ? setMobilePanel((value) => value === "left" ? null : "left") : setLeftCollapsed((value) => !value)}
        onToggleRight={() => isMobile ? setMobilePanel((value) => value === "right" ? null : "right") : setRightPreference(!rightOpen)}
        leftOpen={isMobile ? mobilePanel === "left" : !leftCollapsed}
        rightOpen={isMobile ? mobilePanel === "right" : rightOpen}
        treeViewOpen={treeViewOpen}
        onOpenTree={openTree}
        onCloseTree={closeTree}
        canGenerate={Boolean(activeProfileId) && !modelChanging && !profilesQuery.isFetching}
        appearanceControls={<>
          <label className="form-field"><span>皮肤</span><select aria-label="皮肤" value={theme.themeId} onChange={(event) => theme.setThemeId(event.target.value)}>{theme.themes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="form-field"><span>明暗模式</span><select aria-label="明暗模式" value={theme.mode} onChange={(event) => theme.setMode(event.target.value as "light" | "dark" | "system")}><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></label>
          <button type="button" disabled={theme.loading} onClick={() => void theme.reloadThemes()}>{theme.loading ? "正在读取配置…" : "重读主题配置"}</button>
          <button type="button" data-close-menu onClick={openSettings}>模型与连接设置</button>
        </>}
        modelPicker={<ModelPicker profiles={profilesQuery.data || []} activeProfileId={activeProfileId} onActiveProfileChange={setActiveProfileId}
          onOpenSettings={openSettings} disabled={chat.streaming || profilesQuery.isFetching} onError={setError} onBusyChange={setPickerBusy} onProfileUpdated={profileUpdated}
          onChanged={async () => { await queryClient.invalidateQueries({ queryKey: ["profiles"] }, { throwOnError: true }); }} />}
      />
      <WorkspaceInspector
        tree={tree}
        selectedSessionId={selectedSessionId}
        activeProfileId={activeProfileId}
        worldbooks={worldbooksQuery.data || []}
        onSessionUpdated={(sessionId) => chat.reloadTree(sessionId)}
        onOpenTree={openTree}
        onSelectMessage={chat.handleSelectMessage}
        onCloseMobile={closeInspector}
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
