import { ChangeEvent, useState } from "react";
import { BookOpen, Link, MessageSquarePlus, Plus, RefreshCcw, Server, Upload, UserRound } from "lucide-react";
import { api, APIProfile, Character, ChatSession, ProviderType, WorldBook } from "../lib/api";

type Props = {
  profiles: APIProfile[];
  characters: Character[];
  worldbooks: WorldBook[];
  sessions: ChatSession[];
  selectedSessionId: string | null;
  onSelectSession: (id: string) => void;
  onCreateSession: (payload: Partial<ChatSession>) => void;
  onRefresh: () => void;
};

type ProfileDraft = {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  path_override: string;
  model: string;
  api_key_env: string;
  default_params: Record<string, unknown>;
};

const defaultProfile: ProfileDraft = {
  name: "OpenAI Responses",
  provider_type: "openai_responses",
  base_url: "https://api.openai.com",
  path_override: "",
  model: "gpt-5",
  api_key_env: "OPENAI_API_KEY",
  default_params: { temperature: 0.8 }
};

export function Sidebar({ profiles, characters, worldbooks, sessions, selectedSessionId, onSelectSession, onCreateSession, onRefresh }: Props) {
  const [profile, setProfile] = useState(defaultProfile);
  const [sessionTitle, setSessionTitle] = useState("新的树状会话");
  const [selectedCharacter, setSelectedCharacter] = useState("");
  const [selectedProfile, setSelectedProfile] = useState("");
  const [selectedWorldbook, setSelectedWorldbook] = useState("");
  const [chubPath, setChubPath] = useState("");
  const [busy, setBusy] = useState(false);

  async function importFile(event: ChangeEvent<HTMLInputElement>, kind: "character" | "worldbook") {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      if (kind === "character") await api.importCharacter(file);
      else await api.importWorldbook(file);
      onRefresh();
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function createProfile() {
    setBusy(true);
    try {
      await api.createProfile({
        ...profile,
        path_override: profile.path_override || null,
        default_params: profile.default_params
      });
      onRefresh();
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
    } finally {
      setBusy(false);
    }
  }

  async function createBlankWorldbook() {
    setBusy(true);
    try {
      await api.createWorldbook({ name: "新世界书", description: "关键词触发的世界设定。", entries: [] });
      onRefresh();
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
    } finally {
      setBusy(false);
    }
  }

  function submitSession() {
    onCreateSession({
      title: sessionTitle || "新的树状会话",
      character_id: selectedCharacter || characters[0]?.id || null,
      api_profile_id: selectedProfile || profiles[0]?.id || null,
      worldbook_id: selectedWorldbook || worldbooks[0]?.id || null,
      preset: { user_name: "User", auto_greeting: true }
    });
  }

  return (
    <aside className="left-pane">
      <header className="pane-header">
        <div>
          <p className="eyebrow">TreeChat</p>
          <h1>类酒馆工作台</h1>
        </div>
        <button className="icon-button" title="刷新列表" disabled={busy} onClick={onRefresh}>
          <RefreshCcw size={17} />
        </button>
      </header>

      <section className="tool-section">
        <div className="section-title">
          <MessageSquarePlus size={16} />
          <span>会话</span>
        </div>
        <div className="compact-form">
          <input value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} placeholder="会话标题" />
          <select value={selectedCharacter} onChange={(event) => setSelectedCharacter(event.target.value)}>
            <option value="">选择角色</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}
              </option>
            ))}
          </select>
          <select value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)}>
            <option value="">选择 API Profile</option>
            {profiles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select value={selectedWorldbook} onChange={(event) => setSelectedWorldbook(event.target.value)}>
            <option value="">不绑定世界书</option>
            {worldbooks.map((book) => (
              <option key={book.id} value={book.id}>
                {book.name}
              </option>
            ))}
          </select>
          <button className="primary-button" onClick={submitSession}>
            <Plus size={16} />
            新建会话
          </button>
        </div>
        <div className="list">
          {sessions.map((session) => (
            <button
              key={session.id}
              className={session.id === selectedSessionId ? "list-row selected" : "list-row"}
              onClick={() => onSelectSession(session.id)}
            >
              <span>{session.title}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="tool-section">
        <div className="section-title">
          <Server size={16} />
          <span>API Profiles</span>
        </div>
        <div className="compact-form">
          <input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
          <select
            value={profile.provider_type}
            onChange={(event) => setProfile({ ...profile, provider_type: event.target.value as ProviderType })}
          >
            <option value="openai_responses">OpenAI Responses</option>
            <option value="openai_chat_completions">OpenAI Chat Completions</option>
            <option value="anthropic_messages">Anthropic Messages</option>
          </select>
          <input value={profile.base_url} onChange={(event) => setProfile({ ...profile, base_url: event.target.value })} placeholder="Base URL" />
          <input value={profile.model} onChange={(event) => setProfile({ ...profile, model: event.target.value })} placeholder="Model" />
          <input value={profile.api_key_env} onChange={(event) => setProfile({ ...profile, api_key_env: event.target.value })} placeholder="API key env" />
          <button className="secondary-button" onClick={createProfile}>
            <Plus size={15} />
            保存 Profile
          </button>
        </div>
        <div className="mini-list">
          {profiles.map((item) => (
            <span key={item.id}>
              {item.name} · {item.model}
            </span>
          ))}
        </div>
      </section>

      <section className="tool-section two-column-tools">
        <div className="chub-import">
          <div className="section-title">
            <Link size={16} />
            <span>Chub.ai 导入</span>
          </div>
          <input
            value={chubPath}
            onChange={(event) => setChubPath(event.target.value)}
            placeholder="characters/user/slug 或 lorebooks/user/slug"
          />
          <div className="inline-actions">
            <button className="secondary-button" disabled={busy || !chubPath.trim()} onClick={() => importFromChub("character")}>
              导入角色
            </button>
            <button className="secondary-button" disabled={busy || !chubPath.trim()} onClick={() => importFromChub("worldbook")}>
              导入世界书
            </button>
          </div>
        </div>
        <div>
          <div className="section-title">
            <UserRound size={16} />
            <span>角色卡</span>
          </div>
          <button className="secondary-button" onClick={createBlankCharacter}>
            <Plus size={15} />
            空角色
          </button>
          <label className="file-button">
            <Upload size={15} />
            导入 JSON/PNG
            <input type="file" accept=".json,.png,application/json,image/png" onChange={(event) => importFile(event, "character")} />
          </label>
        </div>
        <div>
          <div className="section-title">
            <BookOpen size={16} />
            <span>世界书</span>
          </div>
          <button className="secondary-button" onClick={createBlankWorldbook}>
            <Plus size={15} />
            空世界书
          </button>
          <label className="file-button">
            <Upload size={15} />
            导入 JSON
            <input type="file" accept=".json,application/json" onChange={(event) => importFile(event, "worldbook")} />
          </label>
        </div>
      </section>
    </aside>
  );
}
