import { useState, type ReactNode } from "react";
import { BookOpen, MessageSquarePlus, RefreshCcw, Settings, SlidersHorizontal, X } from "lucide-react";
import { api, APIProfile, CharacterSummary, ChatSession, WorldBook } from "../lib/api";
import { DisplaySettings } from "./DisplaySettings";
import { AccountPanel } from "./AccountPanel";
import {
  fallbackProfileIdAfterDelete,
  formatTokenLimit,
  ModelSettingsDialog,
  profileDraftHasChanges,
  type ProfileDraft
} from "./ModelSettingsDialog";
import { SessionListPanel, titleForSelectedCharacter } from "./SessionListPanel";
import { SidebarResources } from "./SidebarResources";
import "../styles/model-settings.css";

export {
  fallbackProfileIdAfterDelete,
  formatTokenLimit,
  profileDraftHasChanges,
  titleForSelectedCharacter,
  type ProfileDraft
};

export type SidebarTab = "sessions" | "resources" | "settings";

type Props = {
  profiles: APIProfile[];
  activeProfileId: string;
  onActiveProfileChange: (id: string) => void;
  characters: CharacterSummary[];
  worldbooks: WorldBook[];
  sessions: ChatSession[];
  selectedSessionId: string | null;
  showArchived: boolean;
  onSelectSession: (id: string) => void;
  creatingSession: boolean;
  createSessionError: string | null;
  onCreateSession: (payload: Parameters<typeof api.createSession>[0]) => Promise<ChatSession>;
  onRefresh: () => Promise<void>;
  onToggleArchived: () => void;
  onCloseMobile?: () => void;
  onError?: (message: string) => void;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onOpenSettings?: () => void;
  onBusyChange?: (busy: boolean) => void;
  onModelProgressChange?: (message: string | null) => void;
  onProfileUpdated?: (profile: APIProfile) => void;
  appearanceControls?: ReactNode;
  initialTab?: SidebarTab;
};

export function Sidebar({
  profiles,
  activeProfileId,
  onActiveProfileChange,
  characters,
  worldbooks,
  sessions,
  selectedSessionId,
  showArchived,
  creatingSession,
  createSessionError,
  onSelectSession,
  onCreateSession,
  onRefresh,
  onToggleArchived,
  onCloseMobile,
  onError,
  settingsOpen,
  onCloseSettings,
  onOpenSettings,
  onBusyChange,
  onModelProgressChange,
  onProfileUpdated,
  appearanceControls,
  initialTab = "sessions"
}: Props) {
  const [activeTab, setActiveTab] = useState<SidebarTab>(initialTab);
  const [visitedTabs, setVisitedTabs] = useState(() => new Set<SidebarTab>([initialTab]));
  const [refreshing, setRefreshing] = useState(false);

  function selectTab(tab: SidebarTab) {
    setVisitedTabs((current) => new Set(current).add(tab));
    setActiveTab(tab);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <aside className="left-pane">
        <header className="pane-header">
          <div>
            <p className="eyebrow">YggdrasilTavern</p>
            <h1>真树状角色聊天</h1>
          </div>
          <div className="pane-header-actions">
            <button className="icon-button" type="button" title="刷新列表" aria-label="刷新列表" disabled={refreshing} onClick={() => void handleRefresh()}>
              <RefreshCcw size={17} />
            </button>
            {onCloseMobile && (
              <button className="icon-button mobile-pane-close" type="button" title="关闭资源面板" aria-label="关闭资源面板" onClick={onCloseMobile}>
                <X size={17} />
              </button>
            )}
          </div>
        </header>

        <nav className="pane-tabs" aria-label="侧边栏分区">
          <button
            type="button"
            className={activeTab === "sessions" ? "pane-tab active" : "pane-tab"}
            aria-pressed={activeTab === "sessions"}
            onClick={() => selectTab("sessions")}
          >
            <MessageSquarePlus size={15} />
            <span>会话</span>
            <small className="pane-tab-badge">{sessions.length}</small>
          </button>
          <button
            type="button"
            className={activeTab === "resources" ? "pane-tab active" : "pane-tab"}
            aria-pressed={activeTab === "resources"}
            onClick={() => selectTab("resources")}
          >
            <BookOpen size={15} />
            <span title="角色与世界书">角色</span>
            <small className="pane-tab-badge" title={`${characters.length} 个角色`}>{characters.length}</small>
          </button>
          <button
            type="button"
            className={activeTab === "settings" ? "pane-tab active" : "pane-tab"}
            aria-pressed={activeTab === "settings"}
            onClick={() => selectTab("settings")}
          >
            <SlidersHorizontal size={15} />
            <span>设置</span>
          </button>
        </nav>

        <div className="pane-tab-body">
          {visitedTabs.has("sessions") && (
            <div hidden={activeTab !== "sessions"}>
              <SessionListPanel
                characters={characters}
                sessions={sessions}
                selectedSessionId={selectedSessionId}
                showArchived={showArchived}
                creatingSession={creatingSession}
                createSessionError={createSessionError}
                onSelectSession={onSelectSession}
                onCreateSession={onCreateSession}
                onRefresh={onRefresh}
                onToggleArchived={onToggleArchived}
                onError={onError}
                defaultCollapsible={false}
              />
            </div>
          )}

          {visitedTabs.has("resources") && (
            <div hidden={activeTab !== "resources"}>
              <SidebarResources
                profiles={profiles}
                characters={characters}
                worldbooks={worldbooks}
                onChanged={onRefresh}
                onError={onError}
              />
            </div>
          )}

          {visitedTabs.has("settings") && (
            <div hidden={activeTab !== "settings"}>
              <button className="secondary-button sidebar-settings-button" type="button" onClick={onOpenSettings}>
                <Settings size={16} />
                模型与连接设置
              </button>
              <DisplaySettings>{appearanceControls}</DisplaySettings>
              <AccountPanel />
            </div>
          )}
        </div>
      </aside>
      <ModelSettingsDialog
        profiles={profiles}
        activeProfileId={activeProfileId}
        onActiveProfileChange={onActiveProfileChange}
        settingsOpen={settingsOpen}
        onCloseSettings={onCloseSettings}
        onRefresh={onRefresh}
        onError={onError}
        onBusyChange={onBusyChange}
        onProgressChange={onModelProgressChange}
        onProfileUpdated={onProfileUpdated}
      />
    </>
  );
}
