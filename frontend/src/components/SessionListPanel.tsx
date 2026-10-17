import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Folder, FolderPlus, MessageSquarePlus, Pin, PinOff, Plus, Search, Star, X } from "lucide-react";
import { api, CharacterSummary, ChatSession, SessionFolder, WorldBook } from "../lib/api";
import { ActionMenu } from "./ActionMenu";
import { CollapsibleSection } from "./CollapsibleSection";

export function titleForSelectedCharacter(currentTitle: string, currentCharacterName: string, nextCharacterName: string) {
  return !currentTitle.trim() || currentTitle === currentCharacterName ? nextCharacterName : currentTitle;
}

type Props = {
  characters: CharacterSummary[];
  worldbooks: WorldBook[];
  sessions: ChatSession[];
  selectedSessionId: string | null;
  showArchived: boolean;
  creatingSession: boolean;
  createSessionError: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: (payload: Parameters<typeof api.createSession>[0]) => Promise<ChatSession>;
  onRefresh: () => Promise<void>;
  onToggleArchived: () => void;
  onError?: (message: string) => void;
  defaultCollapsible?: boolean;
};

export function SessionListPanel({
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
  onError,
  defaultCollapsible = true
}: Props) {
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

  useEffect(() => {
    void loadFolders();
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

  async function rebindSessionCharacter(sessionId: string, characterId: string) {
    if (!characterId) return;
    try {
      await api.updateSession(sessionId, { character_id: characterId });
      await onRefresh();
    } catch (exc) {
      onError?.(exc instanceof Error ? exc.message : String(exc));
    }
  }

  // Allow searching by either session title or bound character name.
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredSessions = sessions.filter((session) => {
    if (!showArchived && session.archived) return false;
    if (normalizedQuery) {
      const characterName = characters.find((item) => item.id === session.character_id)?.name || "";
      const matchesTitle = session.title.toLowerCase().includes(normalizedQuery);
      const matchesCharacter = characterName.toLowerCase().includes(normalizedQuery);
      if (!matchesTitle && !matchesCharacter) return false;
    }
    return true;
  });

  const rootSessions = filteredSessions.filter((s) => !s.folder_id);
  const pinnedSessions = rootSessions.filter((s) => s.pinned);
  const unpinnedSessions = rootSessions.filter((s) => !s.pinned);

  function sessionsInFolder(folderId: string) {
    return filteredSessions.filter((s) => s.folder_id === folderId);
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
        preset: { auto_greeting: true, worldbook_ids: selectedWorldbooks }
      });
      resetSessionEditor();
    } catch {
      // Mutation error is rendered next to the create button by AppShell.
    }
  }

  async function createSessionDraft() {
    setSessionTitle("");
    setSelectedCharacter(characters[0]?.id || "");
    if (characters[0]?.name) {
      setSessionTitle(characters[0].name);
    }
    setSelectedWorldbooks([]);
    setSelectedFolderId("");
    setSessionEditorOpen(true);
    try {
      const defaults = await api.sessionDefaults();
      const ids = defaults.preset?.worldbook_ids;
      setSelectedWorldbooks(Array.isArray(ids) ? ids.filter((value): value is string => typeof value === "string" && worldbooks.some((book) => book.id === value)) : []);
    } catch (cause) {
      onError?.(`新会话默认设置读取失败：${cause instanceof Error ? cause.message : String(cause)}`);
    }
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
            <span className="session-character-name">{character?.name || (!session.character_id ? "未绑定角色" : "角色不可用")}</span>
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
            {characters.length > 0 && (
              <label className="form-field session-folder-menu">
                <span>绑定角色</span>
                <select
                  aria-label={`修改会话“${session.title}”的角色`}
                  value={session.character_id || ""}
                  onChange={(event) => void rebindSessionCharacter(session.id, event.target.value)}
                >
                  <option value="" disabled>选择角色…</option>
                  {characters.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
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
          <button className="folder-toggle" type="button" onClick={() => toggleFolder(folder.id)}>
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={14} />
            <span>{folder.name}</span>
            <span className="folder-count">{folderSessions.length}</span>
          </button>
          <button className="icon-button-sm" type="button" title="删除文件夹" onClick={() => void deleteFolder(folder.id)}>
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

  const content = (
    <>
      <div className="session-toolbar">
        <div className="search-bar">
          <Search size={14} />
          <input
            aria-label="搜索会话标题"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索会话或角色..."
          />
          {searchQuery && (
            <button
              className="icon-button-sm"
              type="button"
              title="清除搜索"
              aria-label="清除搜索"
              onClick={() => setSearchQuery("")}
            >
              <X size={12} />
            </button>
          )}
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
          <button className="icon-button" type="button" title="新建会话" aria-label="新建会话" onClick={() => void createSessionDraft()}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      {sessionEditorOpen && (
        <div className="compact-form session-editor">
          <div className="form-caption">
            <strong>新建会话</strong>
            <button className="icon-button" type="button" title="取消新建会话" aria-label="取消新建会话" onClick={resetSessionEditor}><X size={15} /></button>
          </div>
          <label className="form-field"><span>扮演角色（必选）</span><select required value={selectedCharacter} onChange={(event) => selectCharacter(event.target.value)}>
            <option value="">请选择角色</option>
            {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
          </select></label>
          <label className="form-field"><span>会话标题（可选）</span><input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} placeholder="默认使用角色名" /></label>
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
          <button className="primary-button" type="button" disabled={creatingSession || !selectedCharacter} onClick={() => void submitSession()}>
            <Plus size={16} />
            {creatingSession ? "创建中…" : "创建会话"}
          </button>
          {createSessionError && <p className="field-error" role="alert">创建会话失败：{createSessionError}</p>}
        </div>
      )}

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

      <div className="folder-toolbar">
        {showFolderInput ? (
          <div className="inline-folder-input">
            <input
              aria-label="新文件夹名称"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="文件夹名称"
              onKeyDown={(e) => e.key === "Enter" && void createFolder()}
              autoFocus
            />
            <button className="primary-button" type="button" disabled={!newFolderName.trim() || busy} onClick={() => void createFolder()}>OK</button>
            <button className="icon-button" type="button" title="取消新建文件夹" aria-label="取消新建文件夹" onClick={() => { setShowFolderInput(false); setNewFolderName(""); }}><X size={14} /></button>
          </div>
        ) : (
          <button className="secondary-button" type="button" onClick={() => setShowFolderInput(true)}>
            <FolderPlus size={14} />
            新建文件夹
          </button>
        )}
      </div>
    </>
  );

  if (!defaultCollapsible) {
    return <section className="tool-section sidebar-tab-panel">{content}</section>;
  }

  return (
    <CollapsibleSection
      contentId="sidebar-sessions-content"
      title="会话"
      icon={<MessageSquarePlus size={16} />}
      storageKey="yggdrasil-tavern.sidebar.sessions.expanded"
      defaultExpanded
    >
      {content}
    </CollapsibleSection>
  );
}
