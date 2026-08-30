import { ChangeEvent, useEffect, useState } from "react";
import { Archive, ArchiveRestore, BookOpen, ChevronDown, ChevronRight, CloudDownload, Eye, EyeOff, Folder, FolderPlus, Link, MessageSquarePlus, Pencil, Pin, PinOff, Plus, RefreshCcw, Search, Server, Star, Trash2, Upload, UserRound, X } from "lucide-react";
import { api, APIProfile, CharacterSummary, ChatSession, ProviderType, SessionFolder, WorldBook } from "../lib/api";
import { CollapsibleSection } from "./CollapsibleSection";
import { CharacterManager, WorldbookManager } from "./ResourceEditors";

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
  onCreateSession: (payload: Partial<ChatSession>) => Promise<ChatSession>;
  onRefresh: () => Promise<void>;
  onToggleArchived: () => void;
  onCloseMobile?: () => void;
  onError?: (message: string) => void;
};

type ProfileDraft = {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  path_override: string;
  model: string;
  api_key: string;
  default_params: Record<string, unknown>;
};

const defaultProfile: ProfileDraft = {
  name: "OpenAI Responses",
  provider_type: "openai_responses",
  base_url: "https://api.openai.com",
  path_override: "",
  model: "gpt-5",
  api_key: "",
  default_params: { _thinking_level: "auto" }
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
  onError
}: Props) {
  const [profile, setProfile] = useState(defaultProfile);
  const [sessionTitle, setSessionTitle] = useState("");
  const [selectedCharacter, setSelectedCharacter] = useState("");
  const [selectedWorldbooks, setSelectedWorldbooks] = useState<string[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [chubPath, setChubPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [folders, setFolders] = useState<SessionFolder[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [newFolderName, setNewFolderName] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [profileModels, setProfileModels] = useState<Record<string, string[]>>({});
  const [refreshingProfileId, setRefreshingProfileId] = useState<string | null>(null);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const activeProfile = profiles.find((item) => item.id === activeProfileId);

  useEffect(() => {
    loadFolders();
  }, []);

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
      onRefresh();
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
      onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function toggleArchive(session: ChatSession) {
    try {
      await api.updateSession(session.id, { archived: !session.archived });
      onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    }
  }

  async function moveSessionToFolder(sessionId: string, folderId: string | null) {
    try {
      await api.updateSession(sessionId, { folder_id: folderId });
      onRefresh();
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

  async function importFile(event: ChangeEvent<HTMLInputElement>, kind: "character" | "worldbook") {
    const file = event.target.files?.[0];
    if (!file) return;
    onError?.("");
    setBusy(true);
    try {
      if (kind === "character") await api.importCharacter(file);
      else await api.importWorldbook(file);
      onRefresh();
    } catch (exc) {
      const label = kind === "character" ? "角色卡" : "世界书";
      const detail = exc instanceof Error ? exc.message : String(exc);
      onError?.(`导入${label}「${file.name}」失败：${detail}`);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  function resetProfileEditor() {
    setEditingProfileId(null);
    setProfile(defaultProfile);
    setProfileEditorOpen(false);
    setShowApiKey(false);
  }

  function createProfileDraft() {
    setEditingProfileId(null);
    setProfile(defaultProfile);
    setProfileEditorOpen(true);
    setShowApiKey(false);
  }

  function editProfile(item: APIProfile) {
    setEditingProfileId(item.id);
    setProfile({
      name: item.name,
      provider_type: item.provider_type,
      base_url: item.base_url,
      path_override: item.path_override || "",
      model: item.model,
      api_key: "",
      default_params: { _thinking_level: "auto", ...item.default_params }
    });
    setProfileEditorOpen(true);
    setShowApiKey(false);
  }

  async function saveProfile() {
    if (!profile.name.trim() || !profile.base_url.trim() || !profile.model.trim()) {
      onError?.("请填写 Profile 名称、Base URL 和模型名称");
      return;
    }
    const existing = editingProfileId ? profiles.find((item) => item.id === editingProfileId) : undefined;
    if (!profile.api_key.trim() && !existing?.has_api_key && !existing?.api_key_env) {
      onError?.("请填写 API Key；保存后会遮罩，编辑时留空表示不替换");
      return;
    }
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
        default_params: profile.default_params
      };
      if (editingProfileId) {
        await api.updateProfile(editingProfileId, payload);
      } else {
        const created = await api.createProfile(payload);
        createdProfileId = created.id;
      }
      resetProfileEditor();
      await onRefresh();
      if (createdProfileId) onActiveProfileChange(createdProfileId);
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile(item: APIProfile) {
    if (!window.confirm(`删除 API Profile“${item.name}”？已绑定的会话会保留，但需要重新选择 Profile。`)) return;
    setBusy(true);
    try {
      await api.deleteProfile(item.id);
      if (editingProfileId === item.id) resetProfileEditor();
      if (activeProfileId === item.id) {
        onActiveProfileChange(fallbackProfileIdAfterDelete(profiles, item.id));
      }
      onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function createBlankCharacter() {
    setBusy(true);
    try {
      await api.createCharacter({
        name: "Assistant",
        first_mes: "*对方看向你，等待你的第一句话。*",
        description: "一个可自定义的 roleplay 角色。"
      });
      onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function createBlankWorldbook() {
    setBusy(true);
    try {
      await api.createWorldbook({ name: "新世界书", description: "关键词触发的世界设定。", entries: [] });
      onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setBusy(false);
    }
  }

  async function importFromChub(kind: "character" | "worldbook") {
    if (!chubPath.trim()) return;
    setBusy(true);
    try {
      if (kind === "character") await api.importChubCharacter(chubPath.trim());
      else await api.importChubWorldbook(chubPath.trim());
      setChubPath("");
      onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
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
    } catch {
      // Mutation error is rendered next to the create button by AppShell.
    }
  }

  function selectCharacter(characterId: string) {
    const currentCharacterName = characters.find((item) => item.id === selectedCharacter)?.name || "";
    const nextCharacterName = characters.find((item) => item.id === characterId)?.name || "";
    setSelectedCharacter(characterId);
    setSessionTitle((current) => titleForSelectedCharacter(current, currentCharacterName, nextCharacterName));
  }

  async function refreshProfileModels(profileId: string) {
    setRefreshingProfileId(profileId);
    try {
      const response = await api.refreshProfileModels(profileId);
      setProfileModels((current) => ({ ...current, [profileId]: response.models }));
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setRefreshingProfileId(null);
    }
  }

  async function selectRemoteModel(profileId: string, model: string) {
    if (!model) return;
    setRefreshingProfileId(profileId);
    try {
      await api.updateProfile(profileId, { model });
      onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    } finally {
      setRefreshingProfileId(null);
    }
  }

  function renderSessionRow(session: ChatSession) {
    return (
      <div key={session.id} className={session.id === selectedSessionId ? "session-row selected" : "session-row"}>
        <button className="session-title-btn" onClick={() => onSelectSession(session.id)}>
          {session.pinned && <Star size={12} className="pin-icon" />}
          <span>{session.title}</span>
        </button>
        <div className="session-actions">
          <button className="icon-button-sm" title={session.pinned ? "取消置顶" : "置顶"} onClick={() => togglePin(session)}>
            {session.pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
          <button className="icon-button-sm" title={session.archived ? "取消归档" : "归档"} onClick={() => toggleArchive(session)}>
            {session.archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}
          </button>
          <select
            className="folder-select"
            value={session.folder_id || ""}
            onChange={(e) => moveSessionToFolder(session.id, e.target.value || null)}
            title="移动到文件夹"
          >
            <option value="">无文件夹</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
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

  return (
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
          <button
            className={showArchived ? "icon-button active-toggle" : "icon-button"}
            title={showArchived ? "隐藏归档" : "显示归档"}
            onClick={onToggleArchived}
          >
            <Archive size={14} />
          </button>
        </div>

        {/* New session form */}
        <div className="compact-form">
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
            {creatingSession ? "创建中…" : "新建会话"}
          </button>
          {createSessionError && <p className="field-error" role="alert">创建会话失败：{createSessionError}</p>}
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
              <button className="icon-button" onClick={() => { setShowFolderInput(false); setNewFolderName(""); }}>x</button>
            </div>
          ) : (
            <button className="secondary-button" onClick={() => setShowFolderInput(true)}>
              <FolderPlus size={14} />
              新建文件夹
            </button>
          )}
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
      </CollapsibleSection>

      <CollapsibleSection
        contentId="sidebar-api-profiles-content"
        title="API Profiles"
        icon={<Server size={16} />}
        storageKey="yggdrasil-tavern.sidebar.api-profiles.expanded"
      >
        <div className="profile-selector-row">
          <label className="form-field">
            <span>当前 Profile（本机全局）</span>
            <select value={activeProfile?.id || ""} onChange={(event) => { resetProfileEditor(); onActiveProfileChange(event.target.value); }}>
              <option value="">未选择 Profile</option>
              {profiles.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.model}</option>)}
            </select>
          </label>
          <div className="profile-selector-actions">
            <button className="icon-button" type="button" disabled={busy} title="新建 Profile" aria-label="新建 Profile" onClick={createProfileDraft}><Plus size={16} /></button>
            {activeProfile && (
              <>
              <button className="icon-button" type="button" disabled={busy} title={`编辑 ${activeProfile.name}`} aria-label={`编辑 ${activeProfile.name}`} onClick={() => editProfile(activeProfile)}><Pencil size={15} /></button>
              <button className="icon-button" type="button" disabled={refreshingProfileId === activeProfile.id} title="从远端刷新模型列表" aria-label={`刷新 ${activeProfile.name} 的模型列表`} onClick={() => refreshProfileModels(activeProfile.id)}><CloudDownload size={15} /></button>
              <button className="icon-button danger-button" type="button" disabled={busy} title={`删除 ${activeProfile.name}`} aria-label={`删除 ${activeProfile.name}`} onClick={() => deleteProfile(activeProfile)}><Trash2 size={15} /></button>
              </>
            )}
          </div>
        </div>
        <p className="section-help">所有聊天生成使用此项；切换不会改写聊天历史。</p>
        {activeProfile && profileModels[activeProfile.id]?.length ? (
          <label className="form-field profile-model-field"><span>远端模型</span><select value={activeProfile.model} onChange={(event) => selectRemoteModel(activeProfile.id, event.target.value)}><option value={activeProfile.model}>{activeProfile.model}（当前）</option>{profileModels[activeProfile.id].filter((model) => model !== activeProfile.model).map((model) => <option key={model} value={model}>{model}</option>)}</select></label>
        ) : null}
        {profileEditorOpen && (
          <div className="compact-form profile-editor">
            <div className="form-caption">
              <strong>{editingProfileId ? "编辑 API Profile" : "新增 API Profile"}</strong>
              <button className="icon-button" type="button" title="取消编辑" aria-label="取消编辑 Profile" onClick={resetProfileEditor}><X size={15} /></button>
            </div>
            <label className="form-field"><span>Profile 名称</span><input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /><small>给这组连接设置起一个容易辨认的名称。</small></label>
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
            <label className="form-field"><span>思考强度（Thinking Level）</span><select value={String(profile.default_params._thinking_level ?? "auto")} onChange={(event) => setProfile({ ...profile, default_params: { ...profile.default_params, _thinking_level: event.target.value } })}>{thinkingLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>自动使用服务商默认；档位越高通常更慢且消耗更多 token；模型不支持该档位时会显示远端错误。</small></label>
            <label className="form-field"><span>Temperature</span><input type="number" min="0" max="2" step="0.1" value={String(profile.default_params.temperature ?? "")} onChange={(event) => setProfile({ ...profile, default_params: { ...profile.default_params, temperature: event.target.value === "" ? undefined : Number(event.target.value) } })} /><small>数值越高回复越随机；常见范围 0–2。</small></label>
            <button className="secondary-button" type="button" disabled={busy} onClick={saveProfile}>
              {editingProfileId ? <Pencil size={15} /> : <Plus size={15} />}
              {editingProfileId ? "保存修改" : "新增 Profile"}
            </button>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        contentId="sidebar-chub-import-content"
        title="Chub.ai 导入"
        icon={<Link size={16} />}
        storageKey="yggdrasil-tavern.sidebar.chub-import.expanded"
      >
        <div className="chub-import">
          <label className="form-field"><span>Chub 路径</span><input
              value={chubPath}
              onChange={(event) => setChubPath(event.target.value)}
            /><small>填写 characters/user/slug 或 lorebooks/user/slug。</small></label>
          <div className="inline-actions">
            <button className="secondary-button" disabled={busy || !chubPath.trim()} onClick={() => importFromChub("character")}>
              导入角色
            </button>
            <button className="secondary-button" disabled={busy || !chubPath.trim()} onClick={() => importFromChub("worldbook")}>
              导入世界书
            </button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        contentId="sidebar-characters-content"
        title="角色卡"
        icon={<UserRound size={16} />}
        storageKey="yggdrasil-tavern.sidebar.characters.expanded"
      >
        <div>
          <button className="secondary-button" onClick={createBlankCharacter}>
            <Plus size={15} />
            空角色
          </button>
          <label className="file-button">
            <Upload size={15} />
            导入 JSON/PNG
            <input type="file" disabled={busy} accept=".json,.png,application/json,image/png" onChange={(event) => importFile(event, "character")} />
          </label>
          <CharacterManager characters={characters} onChanged={onRefresh} onError={onError} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        contentId="sidebar-worldbooks-content"
        title="世界书"
        icon={<BookOpen size={16} />}
        storageKey="yggdrasil-tavern.sidebar.worldbooks.expanded"
      >
        <div>
          <button className="secondary-button" onClick={createBlankWorldbook}>
            <Plus size={15} />
            空世界书
          </button>
          <label className="file-button">
            <Upload size={15} />
            导入 JSON
            <input type="file" disabled={busy} accept=".json,application/json" onChange={(event) => importFile(event, "worldbook")} />
          </label>
          <WorldbookManager worldbooks={worldbooks} onChanged={onRefresh} onError={onError} />
        </div>
      </CollapsibleSection>
    </aside>
  );
}
