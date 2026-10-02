import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, CloudDownload, Eye, EyeOff, Folder, FolderPlus, MessageSquarePlus, Pencil, Pin, PinOff, Plus, RefreshCcw, Search, Settings, Star, Trash2, X } from "lucide-react";
import { api, APIProfile, CharacterSummary, ChatSession, ProviderType, RemoteModelInfo, SessionFolder, WorldBook } from "../lib/api";
import { ActionMenu } from "./ActionMenu";
import { CollapsibleSection } from "./CollapsibleSection";
import { SidebarResources } from "./SidebarResources";
import "../styles/model-settings.css";

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
  onProfileUpdated?: (profile: APIProfile) => void;
};

type ProfileDraft = {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  path_override: string;
  model: string;
  api_key: string;
  default_params: Record<string, unknown>;
  input_token_limit: number;
  output_token_limit: number;
};

const defaultProfile: ProfileDraft = {
  name: "OpenAI Responses",
  provider_type: "openai_responses",
  base_url: "https://api.openai.com",
  path_override: "",
  model: "gpt-5",
  api_key: "",
  default_params: { _thinking_level: "auto" },
  input_token_limit: 256 * 1024,
  output_token_limit: 32 * 1024
};

const thinkingLevelOptions = [
  { value: "auto", label: "自动" },
  { value: "off", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "更高" },
  { value: "max", label: "最大" }
] as const;

export function titleForSelectedCharacter(currentTitle: string, currentCharacterName: string, nextCharacterName: string) {
  return !currentTitle.trim() || currentTitle === currentCharacterName ? nextCharacterName : currentTitle;
}

export function fallbackProfileIdAfterDelete(profiles: Array<Pick<APIProfile, "id">>, deletedProfileId: string) {
  return profiles.find((profile) => profile.id !== deletedProfileId)?.id || "";
}

export function formatTokenLimit(value?: number | null): string {
  if (!value) return "未知";
  if (value % 1024 === 0) return `${value / 1024}K`;
  return value.toLocaleString();
}

export function profileDraftHasChanges(draft: ProfileDraft, existing?: APIProfile) {
  if (!existing) return true;
  return draft.name.trim() !== existing.name
    || draft.provider_type !== existing.provider_type
    || draft.base_url.trim() !== existing.base_url
    || (draft.path_override || null) !== (existing.path_override || null)
    || draft.model.trim() !== existing.model
    || Boolean(draft.api_key.trim())
    || draft.input_token_limit !== existing.input_token_limit
    || draft.output_token_limit !== existing.output_token_limit
    || JSON.stringify(draft.default_params) !== JSON.stringify({ _thinking_level: "auto", ...existing.default_params });
}

function effectiveProfileLimits(profile: APIProfile, model?: RemoteModelInfo) {
  const output = model?.max_output_tokens
    ? Math.min(profile.output_token_limit, model.max_output_tokens)
    : profile.output_token_limit;
  let input = model?.max_input_tokens
    ? Math.min(profile.input_token_limit, model.max_input_tokens)
    : profile.input_token_limit;
  if (model?.max_total_tokens) input = Math.min(input, Math.max(0, model.max_total_tokens - output));
  return { input, output };
}

function remoteModelLabel(model: RemoteModelInfo): string {
  const limits = model.max_total_tokens
    ? `总窗 ${formatTokenLimit(model.max_total_tokens)}`
    : model.max_input_tokens ? `输入 ${formatTokenLimit(model.max_input_tokens)}` : "";
  return `${model.display_name || model.id}${model.display_name ? ` · ${model.id}` : ""}${limits ? ` · ${limits}` : ""}`;
}

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
  onProfileUpdated
}: Props) {
  const [profile, setProfile] = useState(defaultProfile);
  const [sessionTitle, setSessionTitle] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState("");
  const [selectedWorldbooks, setSelectedWorldbooks] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [sessionEditorOpen, setSessionEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [folders, setFolders] = useState<SessionFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [profileModels, setProfileModels] = useState<Record<string, RemoteModelInfo[]>>({});
  const [refreshingProfileId, setRefreshingProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const activeProfile = profiles.find((item) => item.id === activeProfileId);
  const profileDirty = profileDraftHasChanges(profile, editingProfileId ? profiles.find((item) => item.id === editingProfileId) : undefined);
  const activeCatalog = activeProfile
    ? (profileModels[activeProfile.id] || activeProfile.model_catalog || [])
    : [];
  const activeRemoteModel = activeCatalog.find((item) => item.id === activeProfile?.model);
  const activeEffectiveLimits = activeProfile
    ? effectiveProfileLimits(activeProfile, activeRemoteModel)
    : null;

  useEffect(() => {
    loadFolders();
  }, []);

  useEffect(() => {
    const dialog = settingsDialogRef.current;
    if (!dialog) return;
    if (settingsOpen && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
    } else if (!settingsOpen && dialog.open) {
      dialog.close();
      returnFocusRef.current?.focus();
    }
  }, [settingsOpen]);

  useEffect(() => {
    onBusyChange?.(settingsOpen && (busy || refreshingProfileId !== null));
    return () => onBusyChange?.(false);
  }, [busy, refreshingProfileId, settingsOpen, onBusyChange]);

  function reportProfileError(message: string) {
    setProfileError(message);
    setProfileNotice(null);
    onError?.(message);
  }

  async function loadFolders() {
    try {
      const data = await api.folders();
      setFolders(data);
    } catch (exc) {
      onError?.(`文件夹列表加载失败：${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }

  async function createFolder() {
    if (!newFolderName.trim()) return;
    setBusy(true);
    try {
      await api.createFolder({ name: newFolderName.trim() });
      setNewFolderName("");
      setShowFolderInput(false);
      await loadFolders();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function deleteFolder(folderId: string) {
    setBusy(true);
    try {
      await api.deleteFolder(folderId);
      await loadFolders();
      await onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  function toggleFolder(folderId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  async function togglePin(session: ChatSession) {
    try {
      await api.updateSession(session.id, { pinned: !session.pinned });
      await onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function toggleArchive(session: ChatSession) {
    try {
      await api.updateSession(session.id, { archived: !session.archived });
      await onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function moveSessionToFolder(sessionId: string, folderId: string | null) {
    try {
      await api.updateSession(sessionId, { folder_id: folderId });
      await onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    }
  }

  // Filter and group sessions
  const filteredSessions = sessions.filter((session) => {
    if (!showArchived && session.archived) return false;
    if (searchQuery && !session.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const rootSessions = filteredSessions.filter((s) => !s.folder_id);
  const pinnedSessions = rootSessions.filter((s) => s.pinned);
  const unpinnedSessions = rootSessions.filter((s) => !s.pinned);

  function sessionsInFolder(folderId: string) {
    return filteredSessions.filter((s) => s.folder_id === folderId);
  }

  function resetProfileEditor() {
    setEditingProfileId(null);
    setProfile(defaultProfile);
    setProfileEditorOpen(false);
    setShowApiKey(false);
  }

  function createProfileDraft() {
    setProfileError(null);
    setProfileNotice(null);
    setEditingProfileId(null);
    setProfile(defaultProfile);
    setProfileEditorOpen(true);
    setShowApiKey(false);
  }

  function editProfile(item: APIProfile) {
    setProfileError(null);
    setProfileNotice(null);
    setEditingProfileId(item.id);
    setProfile({
      name: item.name,
      provider_type: item.provider_type,
      base_url: item.base_url,
      path_override: item.path_override || "",
      model: item.model,
      api_key: "",
      default_params: { _thinking_level: "auto", ...item.default_params },
      input_token_limit: item.input_token_limit,
      output_token_limit: item.output_token_limit
    });
    setProfileEditorOpen(true);
    setShowApiKey(false);
  }

  async function saveProfile() {
    if (!profile.name.trim() || !profile.base_url.trim() || !profile.model.trim()) {
      reportProfileError("请填写连接配置名称、服务地址和模型名称");
      return;
    }
    const existing = editingProfileId ? profiles.find((item) => item.id === editingProfileId) : undefined;
    if (!profile.api_key.trim() && !existing?.has_api_key && !existing?.api_key_env) {
      reportProfileError("请填写 API Key；保存后会遮罩，编辑时留空表示不替换");
      return;
    }
    if (!Number.isFinite(profile.input_token_limit) || !Number.isFinite(profile.output_token_limit) || profile.input_token_limit < 1024 || profile.output_token_limit < 1) {
      reportProfileError("输入上限至少为 1024 tokens，输出上限必须大于 0");
      return;
    }
    setProfileError(null);
    setProfileNotice(null);
    setBusy(true);
    try {
      let createdProfileId: string | null = null;
      const payload = {
        name: profile.name.trim(),
        provider_type: profile.provider_type,
        base_url: profile.base_url.trim(),
        path_override: profile.path_override || null,
        model: profile.model.trim(),
        ...(profile.api_key.trim() ? { api_key: profile.api_key.trim() } : {}),
        default_params: profile.default_params,
        input_token_limit: profile.input_token_limit,
        output_token_limit: profile.output_token_limit
      };
      if (editingProfileId) {
        const saved = await api.updateProfile(editingProfileId, payload);
        onProfileUpdated?.(saved);
      } else {
        const created = await api.createProfile(payload);
        createdProfileId = created.id;
        onProfileUpdated?.(created);
      }
      setProfileNotice(`已保存连接配置“${profile.name.trim()}”。`);
      resetProfileEditor();
      await onRefresh();
      if (createdProfileId) onActiveProfileChange(createdProfileId);
    } catch (exc) {
      reportProfileError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile(item: APIProfile) {
    if (!window.confirm(`删除连接配置“${item.name}”？已绑定的会话会保留，但需要重新选择连接配置。`)) return;
    setProfileError(null);
    setProfileNotice(null);
    setBusy(true);
    try {
      await api.deleteProfile(item.id);
      setProfileNotice(`已删除连接配置“${item.name}”。`);
      if (editingProfileId === item.id) resetProfileEditor();
      if (activeProfileId === item.id) {
        onActiveProfileChange(fallbackProfileIdAfterDelete(profiles, item.id));
      }
      await onRefresh();
    } catch (exc) {
      reportProfileError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function submitSession() {
    const character = characters.find((item) => item.id === selectedCharacter);
    if (!character) {
      onError?.("请先选择一个角色，再创建会话");
      return;
    }

    try {
      await onCreateSession({
        title: sessionTitle.trim() || character.name,
        character_id: character.id,
        worldbook_id: selectedWorldbooks[0] || null,
        folder_id: selectedFolderId || null,
        preset: { user_name: "User", auto_greeting: true, worldbook_ids: selectedWorldbooks }
      });
      resetSessionEditor();
    } catch {
      // Mutation error is rendered next to the create button by AppShell.
    }
  }

  function createSessionDraft() {
    setSessionTitle("");
    setSelectedCharacter("");
    setSelectedWorldbooks([]);
    setSelectedFolderId("");
    setSessionEditorOpen(true);
  }

  function resetSessionEditor() {
    setSessionEditorOpen(false);
    setSessionTitle("");
    setSelectedCharacter("");
    setSelectedWorldbooks([]);
    setSelectedFolderId("");
  }

  function selectCharacter(characterId: string) {
    const currentCharacterName = characters.find((item) => item.id === selectedCharacter)?.name || "";
    const nextCharacterName = characters.find((item) => item.id === characterId)?.name || "";
    setSelectedCharacter(characterId);
    setSessionTitle((current) => titleForSelectedCharacter(current, currentCharacterName, nextCharacterName));
  }

  async function refreshProfileModels(profileId: string) {
    setProfileError(null);
    setProfileNotice(null);
    setRefreshingProfileId(profileId);
    try {
      const response = await api.refreshProfileModels(profileId);
      setProfileModels((current) => ({ ...current, [profileId]: response.models }));
      const existing = profiles.find((item) => item.id === profileId);
      if (existing) onProfileUpdated?.({ ...existing, model_catalog: response.models, models_refreshed_at: response.refreshed_at });
      setProfileNotice(`已读取 ${response.models.length} 个远端模型。`);
      await onRefresh();
    } catch (exc) {
      reportProfileError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setRefreshingProfileId(null);
    }
  }

  async function selectRemoteModel(profileId: string, model: string) {
    if (!model) return;
    setProfileError(null);
    setProfileNotice(null);
    setRefreshingProfileId(profileId);
    try {
      const saved = await api.updateProfile(profileId, { model });
      onProfileUpdated?.(saved);
      setProfileNotice(`已切换到 ${model}。`);
      await onRefresh();
    } catch (exc) {
      reportProfileError(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setRefreshingProfileId(null);
    }
  }

  function renderSessionRow(session: ChatSession) {
    const character = characters.find((item) => item.id === session.character_id);
    return (
      <div key={session.id} className={session.id === selectedSessionId ? "session-row selected" : "session-row"}>
        <button className="session-title-btn" type="button" title={session.title} onClick={() => onSelectSession(session.id)}>
          <span className="session-character-avatar" aria-hidden="true">
            {character?.avatar_data_url
              ? <img src={character.avatar_data_url} alt="" />
              : <span>{(character?.name || session.title || "?").slice(0, 1)}</span>}
          </span>
          <span className="session-title-copy">
            <span className="session-title-text">{session.title}</span>
            <span className="session-character-name">{character?.name || "角色不可用"}</span>
          </span>
          {session.pinned && <Star size={13} className="pin-icon" aria-label="已置顶" />}
        </button>
        <div className="session-actions">
          <ActionMenu label={`会话“${session.title}”操作`} className="session-actions-menu">
            <button type="button" data-close-menu onClick={() => void togglePin(session)}>
              {session.pinned ? <PinOff size={15} /> : <Pin size={15} />}
              {session.pinned ? "取消置顶" : "置顶会话"}
            </button>
            <button type="button" data-close-menu onClick={() => void toggleArchive(session)}>
              {session.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
              {session.archived ? "取消归档" : "归档会话"}
            </button>
            <label className="form-field session-folder-menu">
              <span>移动到文件夹</span>
              <select
                aria-label={`移动会话“${session.title}”到文件夹`}
                value={session.folder_id || ""}
                onChange={(event) => void moveSessionToFolder(session.id, event.target.value || null)}
              >
                <option value="">无文件夹</option>
                {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
              </select>
            </label>
          </ActionMenu>
        </div>
      </div>
    );
  }

  function renderFolder(folder: SessionFolder) {
    const expanded = expandedFolders.has(folder.id);
    const folderSessions = sessionsInFolder(folder.id);
    return (
      <div key={folder.id} className="folder-group">
        <div className="folder-header">
          <button className="folder-toggle" onClick={() => toggleFolder(folder.id)}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={14} />
            <span>{folder.name}</span>
            <span className="folder-count">{folderSessions.length}</span>
          </button>
          <button className="icon-button-sm" title="删除文件夹" onClick={() => deleteFolder(folder.id)}>
            <span style={{ fontSize: 11, lineHeight: 1 }}>x</span>
          </button>
        </div>
        {expanded && (
          <div className="folder-children">
            {folderSessions.map(renderSessionRow)}
          </div>
        )}
      </div>
    );
  }

  const profileSettingsDialog = typeof document !== "undefined" ? createPortal(
    <dialog
      ref={settingsDialogRef}
      className="model-settings-dialog"
      aria-labelledby="model-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy && refreshingProfileId === null) onCloseSettings();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy || refreshingProfileId !== null) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onCloseSettings();
      }}
    >
      <header className="model-settings-header">
        <div><h2 id="model-settings-title">模型与连接设置</h2><p>管理模型服务、密钥和默认参数</p></div>
        <button className="icon-button" type="button" aria-label="关闭模型与连接设置" disabled={busy || refreshingProfileId !== null} onClick={onCloseSettings}><X size={18} /></button>
      </header>
      <div className="model-settings-content">
        {profileError && <p className="field-error" role="alert">{profileError}</p>}
        {profileNotice && <p className="model-settings-notice" role="status">{profileNotice}</p>}
        <div className="profile-selector-row">
          <label className="form-field">
            <span>当前连接配置（所有会话共用）</span>
            <select disabled={busy || refreshingProfileId !== null} value={activeProfile?.id || ""} onChange={(event) => { resetProfileEditor(); onActiveProfileChange(event.target.value); }}>
              <option value="">未选择连接配置</option>
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
            </select>
          </label>
          <div className="profile-selector-actions">
            <button className="icon-button" type="button" disabled={busy || refreshingProfileId !== null} title="新建连接配置" aria-label="新建连接配置" onClick={createProfileDraft}><Plus size={16} /></button>
            {activeProfile && (
              <>
              <button className="icon-button" type="button" disabled={busy || refreshingProfileId !== null} title={`编辑 ${activeProfile.name}`} aria-label={`编辑 ${activeProfile.name}`} onClick={() => editProfile(activeProfile)}><Pencil size={15} /></button>
              <button className="icon-button" type="button" disabled={busy || refreshingProfileId !== null} title="从远端刷新模型列表" aria-label={`刷新 ${activeProfile.name} 的模型列表`} onClick={() => refreshProfileModels(activeProfile.id)}><CloudDownload size={15} /></button>
              <button className="icon-button danger-button" type="button" disabled={busy || refreshingProfileId !== null} title={`删除 ${activeProfile.name}`} aria-label={`删除 ${activeProfile.name}`} onClick={() => deleteProfile(activeProfile)}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        </div>
        <p className="section-help">此处管理服务地址、密钥和生成参数。输入区会显示实际使用的模型。</p>
        {activeProfile && activeEffectiveLimits ? (
          <div className="profile-budget-summary" aria-label="当前 Token 预算">
            <span>配置输入 {formatTokenLimit(activeProfile.input_token_limit)}</span>
            <span>配置输出 {formatTokenLimit(activeProfile.output_token_limit)}</span>
            {(activeEffectiveLimits.input !== activeProfile.input_token_limit || activeEffectiveLimits.output !== activeProfile.output_token_limit) && (
              <span>生效 {formatTokenLimit(activeEffectiveLimits.input)} / {formatTokenLimit(activeEffectiveLimits.output)}</span>
            )}
            {activeRemoteModel?.max_total_tokens ? <span>模型总窗 {formatTokenLimit(activeRemoteModel.max_total_tokens)}</span> : null}
            {activeRemoteModel?.supports_reasoning === true ? <span>Reasoning</span> : null}
            {activeRemoteModel?.supports_vision === true ? <span>Vision</span> : null}
          </div>
        ) : null}
        {activeProfile && activeCatalog.length ? (
          <label className="form-field profile-model-field"><span>远端模型</span><select disabled={busy || refreshingProfileId !== null} value={activeProfile.model} onChange={(event) => selectRemoteModel(activeProfile.id, event.target.value)}>{!activeCatalog.some((model) => model.id === activeProfile.model) ? <option value={activeProfile.model}>{activeProfile.model}（当前；远端未报告）</option> : null}{activeCatalog.map((model) => <option key={model.id} value={model.id}>{remoteModelLabel(model)}</option>)}</select></label>
        ) : null}
        {profileEditorOpen && (
          <div className="compact-form profile-editor">
            <div className="form-caption">
              <strong>{editingProfileId ? "编辑连接配置" : "新增连接配置"}</strong>
              <button className="icon-button" type="button" title="取消编辑" aria-label="取消编辑连接配置" onClick={resetProfileEditor}><X size={15} /></button>
            </div>
            <label className="form-field"><span>连接配置名称</span><input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /><small>给这组连接设置起一个容易辨认的名称。</small></label>
            <label className="form-field"><span>API 协议</span><select
                value={profile.provider_type}
                onChange={(event) => setProfile({ ...profile, provider_type: event.target.value as ProviderType })}
              >
                <option value="openai_responses">OpenAI Responses API</option>
                <option value="openai_chat_completions">OpenAI 兼容 Chat Completions</option>
                <option value="anthropic_messages">Anthropic Messages API</option>
              </select><small>需与服务商文档所写的接口格式一致；Kimi 等兼容服务通常选 Chat Completions。</small></label>
            <label className="form-field"><span>Base URL</span><input value={profile.base_url} onChange={(event) => setProfile({ ...profile, base_url: event.target.value })} /><small>服务地址，例如 https://api.moonshot.cn/v1；末尾的 /v1 可保留。</small></label>
            <label className="form-field"><span>自定义请求路径（可选）</span><input value={profile.path_override} onChange={(event) => setProfile({ ...profile, path_override: event.target.value })} /><small>留空会按所选协议使用默认路径；只有服务商明确给出不同路径时才填写。</small></label>
            <label className="form-field"><span>模型名称</span><input value={profile.model} onChange={(event) => setProfile({ ...profile, model: event.target.value })} /><small>发送给 API 的模型 ID；保存后也可从远端模型列表选择。</small></label>
            <label className="form-field"><span>API Key</span><div className="secret-input"><input type={showApiKey ? "text" : "password"} autoComplete="off" value={profile.api_key} onChange={(event) => setProfile({ ...profile, api_key: event.target.value.trim() })} /><button className="icon-button" type="button" aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"} title={showApiKey ? "隐藏" : "显示"} onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? <EyeOff size={15} /> : <Eye size={15} />}</button></div><small>{editingProfileId && profiles.find((item) => item.id === editingProfileId)?.has_api_key ? "已保存；普通编辑可留空。若修改协议、Base URL 或请求路径，必须重新输入 Key。" : "直接粘贴服务商提供的 Key；首尾空格会自动移除，本地保存且读取接口不会回传明文。"}</small></label>
            <div className="profile-token-limits">
              <label className="form-field"><span>输入上下文上限</span><input type="number" min="1024" step="1024" value={profile.input_token_limit} onChange={(event) => setProfile({ ...profile, input_token_limit: Number(event.target.value) })} /><small>默认 262144（256K）。超出时只从当前树路径移除最旧历史，固定 Prompt 和最近消息不会被截断。</small></label>
              <label className="form-field"><span>最大输出 Token</span><input type="number" min="1" step="1024" value={profile.output_token_limit} onChange={(event) => setProfile({ ...profile, output_token_limit: Number(event.target.value) })} /><small>默认 32768（32K），包含模型可能使用的 reasoning tokens；若远端报告更小上限，会使用较小值。</small></label>
            </div>
            {editingProfileId === activeProfile?.id && activeRemoteModel ? <small className="model-capability-note">远端报告：{activeRemoteModel.max_input_tokens ? `最大输入 ${formatTokenLimit(activeRemoteModel.max_input_tokens)}；` : ""}{activeRemoteModel.max_output_tokens ? `最大输出 ${formatTokenLimit(activeRemoteModel.max_output_tokens)}；` : ""}{activeRemoteModel.max_total_tokens ? `总上下文 ${formatTokenLimit(activeRemoteModel.max_total_tokens)}；` : ""}{!activeRemoteModel.max_input_tokens && !activeRemoteModel.max_output_tokens && !activeRemoteModel.max_total_tokens ? "未提供 Context 上限。" : "配置高于模型能力时会自动收紧生效值。"}</small> : null}
            <label className="form-field"><span>思考强度（Thinking Level）</span><select value={String(profile.default_params._thinking_level ?? "auto")} onChange={(event) => setProfile({ ...profile, default_params: { ...profile.default_params, _thinking_level: event.target.value } })}>{thinkingLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>自动使用服务商默认；档位越高通常更慢且消耗更多 token；模型不支持该档位时会显示远端错误。</small></label>
            <label className="form-field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={String(profile.default_params.temperature ?? "")} onChange={(event) => setProfile({ ...profile, default_params: { ...profile.default_params, temperature: event.target.value === "" ? undefined : Number(event.target.value) } })} /><small>数值越高回复越随机；常见范围 0–2。</small></label>
            <button className={profileDirty ? "primary-button" : "secondary-button"} type="button" disabled={busy || refreshingProfileId !== null || !profileDirty} onClick={saveProfile}>
              {editingProfileId ? <Pencil size={15} /> : <Plus size={15} />}
              {busy ? "保存中…" : editingProfileId ? (profileDirty ? "保存修改" : "没有未保存的修改") : "新增连接配置"}
            </button>
          </div>
        )}
      </div>
    </dialog>,
    document.body
  ) : null;

  return (
    <>
    <aside className="left-pane">
      <header className="pane-header">
        <div>
          <p className="eyebrow">YggdrasilTavern</p>
          <h1>真树状角色聊天</h1>
        </div>
        <div className="pane-header-actions"><button className="icon-button" title="刷新列表" disabled={busy} onClick={onRefresh}><RefreshCcw size={17} /></button>{onCloseMobile && <button className="icon-button mobile-pane-close" title="关闭资源面板" aria-label="关闭资源面板" onClick={onCloseMobile}><X size={17} /></button>}</div>
      </header>

      <CollapsibleSection
        contentId="sidebar-sessions-content"
        title="会话"
        icon={<MessageSquarePlus size={16} />}
        storageKey="yggdrasil-tavern.sidebar.sessions.expanded"
        defaultExpanded
      >
        {/* Search and archive toggle */}
        <div className="session-toolbar">
          <div className="search-bar">
            <Search size={14} />
            <input
              aria-label="搜索会话标题"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索会话..."
            />
          </div>
          <div className="session-toolbar-actions">
            <button
              className={showArchived ? "icon-button active-toggle" : "icon-button"}
              type="button"
              title={showArchived ? "隐藏归档" : "显示归档"}
              aria-label={showArchived ? "隐藏归档会话" : "显示归档会话"}
              onClick={onToggleArchived}
            >
              <Archive size={14} />
            </button>
            <button className="icon-button" type="button" title="新建会话" aria-label="新建会话" onClick={createSessionDraft}>
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Session list with folders */}
        <div className="session-list">
          {pinnedSessions.length > 0 && (
            <div className="session-group">
              <div className="group-label"><Star size={12} /> 置顶</div>
              {pinnedSessions.map(renderSessionRow)}
            </div>
          )}
          {folders.map(renderFolder)}
          {unpinnedSessions.length > 0 && (
            <div className="session-group">
              {folders.length > 0 && pinnedSessions.length > 0 && <div className="group-label">其他</div>}
              {unpinnedSessions.map(renderSessionRow)}
            </div>
          )}
          {filteredSessions.length === 0 && (
            <p className="muted" style={{ padding: "8px 0" }}>
              {searchQuery ? "没有匹配的会话" : showArchived ? "没有归档会话" : "暂无会话"}
            </p>
          )}
        </div>

        {/* Folder management */}
        <div className="folder-toolbar">
          {showFolderInput ? (
            <div className="inline-folder-input">
              <input
                aria-label="新文件夹名称"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="文件夹名称"
                onKeyDown={(e) => e.key === "Enter" && createFolder()}
                autoFocus
              />
              <button className="primary-button" disabled={!newFolderName.trim()} onClick={createFolder}>OK</button>
              <button className="icon-button" title="取消新建文件夹" aria-label="取消新建文件夹" onClick={() => { setShowFolderInput(false); setNewFolderName(""); }}><X size={14} /></button>
            </div>
          ) : (
            <button className="secondary-button" onClick={() => setShowFolderInput(true)}>
              <FolderPlus size={14} />
              新建文件夹
            </button>
          )}
        </div>

        {/* New session form */}
        {sessionEditorOpen && (
          <div className="compact-form session-editor">
            <div className="form-caption">
              <strong>新建会话</strong>
              <button className="icon-button" type="button" title="取消新建会话" aria-label="取消新建会话" onClick={resetSessionEditor}><X size={15} /></button>
            </div>
            <label className="form-field"><span>扮演角色（必选）</span><select required value={selectedCharacter} onChange={(event) => selectCharacter(event.target.value)}>
              <option value="">请选择角色</option>
              {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
            </select><small>决定角色设定、开场白和头像；必须选择后才能创建会话。</small></label>
            <label className="form-field"><span>会话标题（可选）</span><input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} placeholder="默认使用角色名" /><small>留空时使用所选角色名；手动填写可覆盖。</small></label>
            <fieldset className="compact-check-list">
              <legend>绑定多个世界书（可留空）</legend>
              {worldbooks.map((book) => (
                <label key={book.id}>
                  <input
                    type="checkbox"
                    checked={selectedWorldbooks.includes(book.id)}
                    onChange={() => setSelectedWorldbooks((current) => current.includes(book.id) ? current.filter((id) => id !== book.id) : [...current, book.id])}
                  />
                  {book.name}
                </label>
              ))}
              {!worldbooks.length && <span className="muted">暂无世界书</span>}
            </fieldset>
            <label className="form-field"><span>保存位置</span><select value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)}>
              <option value="">不放入文件夹</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select></label>
            <button className="primary-button" disabled={creatingSession || !selectedCharacter} onClick={submitSession}>
              <Plus size={16} />
              {creatingSession ? "创建中…" : "创建会话"}
            </button>
            {createSessionError && <p className="field-error" role="alert">创建会话失败：{createSessionError}</p>}
          </div>
        )}
      </CollapsibleSection>

      <button className="secondary-button sidebar-settings-button" type="button" onClick={onOpenSettings}><Settings size={16} />模型与连接设置</button>

      <SidebarResources characters={characters} worldbooks={worldbooks} onChanged={onRefresh} onError={onError} />
    </aside>
    {profileSettingsDialog}
    </>
  );
}
