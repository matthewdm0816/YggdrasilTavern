import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, X } from "lucide-react";
import { api, APIProfile, ChatSession, RegexRule, SessionTree } from "./lib/api";
import { useAppStore } from "./state/useAppStore";
import { useChatController } from "./features/chat/useChatController";
import { Sidebar } from "./components/Sidebar";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { WorkspaceInspector } from "./components/WorkspaceInspector";
import { ModelPicker } from "./components/ModelPicker";
import { Volume2 } from "lucide-react";
import { useTtsPlayback } from "./features/tts/useTtsPlayback";
import { TtsSettingsDialog } from "./features/tts/TtsSettingsDialog";
import { TtsMessageDialog } from "./features/tts/TtsMessageDialog";
import { TtsPlaybackBar } from "./features/tts/TtsPlaybackBar";
import { globalWorldbookRegexQuery } from "./components/GlobalWorldbookRegexPanel";
import { useMediaQuery } from "./lib/useMediaQuery";
import { useTheme } from "./features/theme";
import { userStorageKey } from "./lib/userStorage";

const ACTIVE_PROFILE_STORAGE_KEY = "yggdrasil-tavern.active-api-profile";
const NO_REGEX_RULES: RegexRule[] = [];

function loadActiveProfileId(): string {
  try {
    return window.localStorage.getItem(userStorageKey(ACTIVE_PROFILE_STORAGE_KEY)) || "";
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
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  const [ttsPreviewId, setTtsPreviewId] = useState<string | null>(null);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [modelSettingsProgress, setModelSettingsProgress] = useState<string | null>(null);
  const modelChanging = pickerBusy || settingsBusy;
  const [treeViewOpen, setTreeViewOpen] = useState(false);
  const theme = useTheme();
  const [activeProfileId, setActiveProfileId] = useState(loadActiveProfileId);

  const profilesQuery = useQuery({ queryKey: ["profiles"], queryFn: api.profiles });
  const charactersQuery = useQuery({ queryKey: ["characters"], queryFn: api.characters });
  const worldbooksQuery = useQuery({ queryKey: ["worldbooks"], queryFn: api.worldbooks });
  const worldbookRegexQuery = useQuery(globalWorldbookRegexQuery);
  const sessionsQuery = useQuery({
    queryKey: ["sessions", showArchived],
    queryFn: () => api.sessions(showArchived ? { archived: true } : undefined)
  });
  const tts = useTtsPlayback(selectedSessionId);
  const chat = useChatController({ selectedSessionId, activeProfileId, onMessageCompleted: (message) => {
    const latest = queryClient.getQueryData<SessionTree>(["tree", message.session_id]);
    if (latest?.active_path_ids.includes(message.id)) tts.onGenerated(message);
  } });
  const tree = chat.tree;
  const ttsPreviewMessage = tree?.messages.find(message => message.id === ttsPreviewId && message.role === "assistant" && message.status === "complete");
  const spokenVersion = useRef<{ id: string; content: string } | null>(null);
  useEffect(() => { setTtsPreviewId(null); }, [selectedSessionId]);
  useEffect(() => {
    const message = tree?.messages.find(item => item.id === tts.state.messageId);
    if (!tts.state.messageId) { spokenVersion.current = null; return; }
    if (!message || message.role !== "assistant" || message.status !== "complete" || !tree?.active_path_ids.includes(message.id)) {
      tts.stop(); return;
    }
    if (spokenVersion.current?.id === message.id && spokenVersion.current.content !== message.content) {
      tts.stop(); return;
    }
    spokenVersion.current = { id: message.id, content: message.content };
  }, [tree, tts.state.messageId, tts.stop]);
  const openTtsSettings = () => { setTtsPreviewId(null); setMobilePanel(null); setTtsSettingsOpen(true); };

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
      if (activeProfileId) window.localStorage.setItem(userStorageKey(ACTIVE_PROFILE_STORAGE_KEY), activeProfileId);
      else window.localStorage.removeItem(userStorageKey(ACTIVE_PROFILE_STORAGE_KEY));
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
        if (document.querySelector("dialog[open], .action-menu, .forest-tree-dialog, .modal-backdrop")) return;
        if (isMobile) setMobilePanel(null); else setRightPreference(false);
      }
      if (event.key === "Tab" && !document.querySelector("dialog[open], .action-menu, .forest-tree-dialog, .modal-backdrop")) {
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
  const queryError = chat.treeQuery.error || sessionsQuery.error || profilesQuery.error || charactersQuery.error || worldbooksQuery.error || worldbookRegexQuery.error;
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
        onOpenTtsSettings={openTtsSettings}
        onBusyChange={setSettingsBusy}
        onModelProgressChange={setModelSettingsProgress}
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
            // Deleting a worldbook also removes it from the global selection.
            queryClient.invalidateQueries({ queryKey: globalWorldbookRegexQuery.queryKey }),
            queryClient.invalidateQueries({ queryKey: ["sessions"] }),
            queryClient.invalidateQueries({ queryKey: ["context-preview"] })
          ]);
        }}
        onToggleArchived={() => setShowArchived(!showArchived)}
        onCloseMobile={() => { setMobilePanel(null); if (!isMobile) setLeftCollapsed(true); }}
        onError={setError}
        appearanceControls={<>
          <label className="form-field"><span>皮肤</span><select aria-label="皮肤" value={theme.themeId} onChange={(event) => theme.setThemeId(event.target.value)}>{theme.themes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label className="form-field"><span>明暗模式</span><select aria-label="明暗模式" value={theme.mode} onChange={(event) => theme.setMode(event.target.value as "light" | "dark" | "system")}><option value="system">跟随系统</option><option value="light">亮色</option><option value="dark">暗色</option></select></label>
          <button className="secondary-button" type="button" disabled={theme.loading} onClick={() => void theme.reloadThemes()}>{theme.loading ? "正在读取配置…" : "重读主题配置"}</button>
        </>}
      />
      <ChatWorkspace
        tree={tree}
        activeSession={activeSession}
        characters={charactersQuery.data || []}
        loading={chat.treeQuery.isPending && Boolean(selectedSessionId)}
        loadError={chat.treeQuery.error instanceof Error ? chat.treeQuery.error.message : null}
        streaming={chat.streaming}
        mutating={chat.mutating}
        onReadMessage={(message) => setTtsPreviewId(message.id)}
        ttsControls={<><button className="secondary-button" type="button" onClick={openTtsSettings}><Volume2 size={15} />语音朗读设置</button><TtsPlaybackBar playback={tts} />{tts.settingsQuery.error && <p className="field-error" role="alert">语音设置读取失败：{tts.settingsQuery.error instanceof Error ? tts.settingsQuery.error.message : String(tts.settingsQuery.error)}</p>}</>}
        onSend={chat.handleSend}
        onGenerate={() => chat.handleGenerate()}
        onStop={chat.stopGeneration}
        onRegenerate={chat.handleGenerate}
        onSelectMessage={chat.handleSelectMessage}
        onCreateSwipe={chat.handleCreateSwipe}
        onUpdateMessage={chat.handleUpdateMessage}
        onChangeMessageRole={chat.handleChangeMessageRole}
        onDeleteMessage={chat.handleDeleteMessage}
        onPruneEmptyBranches={chat.handlePruneEmptyBranches}
        onToggleLeft={() => isMobile ? setMobilePanel((value) => value === "left" ? null : "left") : setLeftCollapsed((value) => !value)}
        onToggleRight={() => isMobile ? setMobilePanel((value) => value === "right" ? null : "right") : setRightPreference(!rightOpen)}
        leftOpen={isMobile ? mobilePanel === "left" : !leftCollapsed}
        rightOpen={isMobile ? mobilePanel === "right" : rightOpen}
        treeViewOpen={treeViewOpen}
        onOpenTree={openTree}
        onCloseTree={closeTree}
        canGenerate={Boolean(activeProfileId) && !modelChanging && !profilesQuery.isFetching}
        onQuickCreateSession={(payload) => createSession.mutateAsync(payload)}
        onOpenSettings={openSettings}
        regexRules={worldbookRegexQuery.data?.regex_rules ?? NO_REGEX_RULES}
        modelPicker={<ModelPicker profiles={profilesQuery.data || []} activeProfileId={activeProfileId} onActiveProfileChange={setActiveProfileId}
          loadingMessage={modelSettingsProgress || (profilesQuery.isFetching ? "正在读取连接配置…" : null)}
          onOpenSettings={openSettings} disabled={chat.streaming || profilesQuery.isFetching} onError={setError} onBusyChange={setPickerBusy} onProfileUpdated={profileUpdated}
          onChanged={async () => { await queryClient.invalidateQueries({ queryKey: ["profiles"] }, { throwOnError: true }); }} />}
      />
      <WorkspaceInspector
        tree={tree}
        selectedSessionId={selectedSessionId}
        activeProfileId={activeProfileId}
        worldbooks={worldbooksQuery.data || []}
        onOpenTree={openTree}
        onSelectMessage={chat.handleSelectMessage}
        onCloseMobile={closeInspector}
        onError={setError}
      />
      <TtsSettingsDialog open={ttsSettingsOpen} onClose={() => setTtsSettingsOpen(false)} />
      {ttsPreviewMessage && <TtsMessageDialog message={ttsPreviewMessage} settings={tts.settingsQuery.data} playback={tts}
        onClose={() => setTtsPreviewId(null)} onSettings={openTtsSettings} />}
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
