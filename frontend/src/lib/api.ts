export type ProviderType = "anthropic_messages" | "openai_chat_completions" | "openai_responses";

export type APIProfile = {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string;
  path_override?: string | null;
  model: string;
  api_key_env: string;
  has_api_key: boolean;
  default_params: Record<string, unknown>;
  models?: string[];
};

export type APIProfileWrite = {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  path_override?: string | null;
  model: string;
  api_key?: string;
  api_key_env?: string;
  default_params: Record<string, unknown>;
};

export type AvatarTransform = {
  zoom: number;
  offset_x: number;
  offset_y: number;
  rotation: 0 | 90 | 180 | 270;
  flip_x: boolean;
  flip_y: boolean;
};

export type CharacterSummary = {
  id: string;
  name: string;
  avatar_data_url?: string | null;
  avatar_transform?: AvatarTransform | null;
  tags: string[];
  creator: string;
  character_version: string;
  updated_at?: string;
};

export type Character = CharacterSummary & {
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  alternate_greetings: string[];
  avatar_original_data_url?: string | null;
  raw_json: Record<string, unknown>;
  extensions: Record<string, unknown>;
  character_book?: Record<string, unknown> | null;
};

export type WorldBookEntry = {
  id: string;
  worldbook_id: string;
  keys: string[];
  secondary_keys: string[];
  content: string;
  enabled: boolean;
  constant: boolean;
  selective: boolean;
  order: number;
  position: string;
  uid?: string | null;
  depth?: number | null;
  case_sensitive: boolean;
  match_whole_words: boolean;
  raw_json: Record<string, unknown>;
};

export type WorldBook = {
  id: string;
  name: string;
  description: string;
  scan_depth: number;
  token_budget: number;
  recursive_scanning: boolean;
  raw_json: Record<string, unknown>;
  entries: WorldBookEntry[];
};

export type SessionFolder = {
  id: string;
  name: string;
  parent_id?: string | null;
  sort_order: number;
};

export type ChatSession = {
  id: string;
  title: string;
  character_id?: string | null;
  api_profile_id?: string | null;
  worldbook_id?: string | null;
  folder_id?: string | null;
  pinned?: boolean;
  archived?: boolean;
  preset: Record<string, unknown>;
  active_root_child_id?: string | null;
};

export type GenerationRun = {
  id: string;
  session_id: string;
  base_message_id?: string | null;
  output_message_id?: string | null;
  api_profile_id?: string | null;
  profile_name: string;
  provider_type: string;
  base_url?: string;
  model: string;
  parameters?: Record<string, unknown>;
  prompt_snapshot?: Record<string, unknown>;
  prompt_hash?: string;
  status: string;
  started_at: string;
  first_token_at?: string | null;
  completed_at?: string | null;
  duration_seconds: number;
  error?: string | null;
  usage?: Record<string, unknown>;
  usage_source: string;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  tokens_per_second: number;
  created_at?: string;
  updated_at?: string;
};

export type PromptSlotKind =
  | "main"
  | "world_before"
  | "char_description"
  | "char_personality"
  | "scenario"
  | "examples"
  | "pre_history"
  | "history"
  | "world_after"
  | "post_history"
  | "custom";

export type PromptSlot = {
  id: string;
  kind: PromptSlotKind;
  name: string;
  enabled: boolean;
  role: "system" | "user" | "assistant";
  content: string | null;
};

export type GlobalPromptConfig = {
  prompt_slots: PromptSlot[];
  revision: number;
  updated_at?: string | null;
};

export type RegexTarget = "display" | "outgoing_prompt" | "user_input" | "assistant_output";

export type RegexRule = {
  id: string;
  name: string;
  enabled: boolean;
  scope: "session" | "character" | "global";
  targets: RegexTarget[];
  mode: "replace" | "veil";
  pattern: string;
  flags: string;
  replacement: string;
};

export type PromptDiagnostic = {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
  slot_id?: string | null;
  rule_id?: string | null;
  match_count?: number | null;
};

export type CompiledPromptBlock = {
  slot_id: string;
  slot_kind: PromptSlotKind;
  slot_name: string;
  source: string;
  role: "system" | "user" | "assistant";
  content: string;
  token_count: number;
  is_history: boolean;
  message_id?: string | null;
  speaker: string;
};

export type Message = {
  id: string;
  session_id: string;
  parent_id?: string | null;
  selected_child_id?: string | null;
  role: "system" | "user" | "assistant";
  speaker: string;
  content: string;
  thinking_content: string;
  status: string;
  token_count: number;
  thinking_token_count: number;
  cached_tokens: number;
  sort_order: number;
  provider_metadata: Record<string, unknown>;
  usage: Record<string, unknown>;
  generation_run?: GenerationRun | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
};

export type SessionTree = {
  session: ChatSession;
  messages: Message[];
  active_path_ids: string[];
};

export type ContextPreview = {
  system: string;
  messages: Array<{ role: string; speaker: string; content: string }>;
  activated_lore: Array<{ id: string; worldbook_id: string; order: number; position: string; content: string; keys: string[] }>;
  compiled_blocks: CompiledPromptBlock[];
  diagnostics: PromptDiagnostic[];
  worldbook_ids: string[];
  prompt_config_revision: number;
};

export type AuthStatus = {
  enabled: boolean;
  authenticated: boolean;
  username: string | null;
};

export type AuthLogin = {
  username: string;
  password: string;
};

const API_BASE = import.meta.env.VITE_API_BASE || "";
export const AUTH_REQUIRED_EVENT = "yggdrasil:auth-required";

function notifyAuthenticationRequired(path: string, response: Response): void {
  if (response.status !== 401 || path === "/api/auth/login" || typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
}

async function responseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) return response.statusText || `HTTP ${response.status}`;
  try {
    const payload = JSON.parse(text) as { detail?: unknown };
    if (typeof payload.detail === "string") return payload.detail;
    if (Array.isArray(payload.detail)) {
      const messages = payload.detail.map((item) => {
        if (!item || typeof item !== "object") return "请求内容无效";
        const value = item as { loc?: unknown; msg?: unknown };
        const location = Array.isArray(value.loc)
          ? value.loc.slice(1).map(String).join(".")
          : "";
        const message = typeof value.msg === "string" ? value.msg : "内容无效";
        return location ? `${location}：${message}` : message;
      });
      return messages.join("；");
    }
    if (payload.detail && typeof payload.detail === "object") {
      const detail = payload.detail as { message?: unknown };
      if (typeof detail.message === "string") return detail.message;
    }
  } catch {
    // Non-JSON provider errors are intentionally returned as plain text.
  }
  return text;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    notifyAuthenticationRequired(path, response);
    throw new Error(await responseError(response));
  }
  return response.json() as Promise<T>;
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", body: form, credentials: "include" });
  if (!response.ok) {
    notifyAuthenticationRequired(path, response);
    throw new Error(await responseError(response));
  }
  return response.json() as Promise<T>;
}

async function download(path: string, fallbackName: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { credentials: "include" });
  if (!response.ok) {
    notifyAuthenticationRequired(path, response);
    throw new Error(await responseError(response));
  }
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const simpleName = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  const filename = encodedName ? decodeURIComponent(encodedName) : simpleName || fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  authLogin: (payload: AuthLogin) =>
    request<AuthStatus>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  authLogout: () => request<AuthStatus>("/api/auth/logout", { method: "POST", body: "{}" }),
  profiles: () => request<APIProfile[]>("/api/api-profiles"),
  createProfile: (payload: APIProfileWrite) =>
    request<APIProfile>("/api/api-profiles", { method: "POST", body: JSON.stringify(payload) }),
  updateProfile: (profileId: string, payload: Partial<APIProfileWrite>) =>
    request<APIProfile>(`/api/api-profiles/${profileId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteProfile: (profileId: string) =>
    request<{ ok: boolean }>(`/api/api-profiles/${profileId}`, { method: "DELETE" }),
  refreshProfileModels: (profileId: string) =>
    request<{ models: string[] }>(`/api/api-profiles/${profileId}/models/refresh`, { method: "POST", body: "{}" }),
  globalPromptConfig: () => request<GlobalPromptConfig>("/api/settings/prompt"),
  updateGlobalPromptConfig: (payload: { prompt_slots: PromptSlot[]; expected_revision: number }) =>
    request<GlobalPromptConfig>("/api/settings/prompt", { method: "PUT", body: JSON.stringify(payload) }),
  characters: () => request<CharacterSummary[]>("/api/characters"),
  character: (characterId: string) => request<Character>(`/api/characters/${characterId}`),
  createCharacter: (payload: Partial<Character>) =>
    request<Character>("/api/characters", { method: "POST", body: JSON.stringify(payload) }),
  importCharacter: (file: File) => upload<Character>("/api/characters/import", file),
  importChubCharacter: (url_or_path: string) =>
    request<Character>("/api/characters/import/chub", { method: "POST", body: JSON.stringify({ url_or_path }) }),
  updateCharacter: (characterId: string, payload: Partial<Character>) =>
    request<Character>(`/api/characters/${characterId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCharacter: (characterId: string) => request<{ ok: boolean }>(`/api/characters/${characterId}`, { method: "DELETE" }),
  exportCharacter: (characterId: string, name = "character.json") => download(`/api/characters/${characterId}/export`, name),
  worldbooks: () => request<WorldBook[]>("/api/worldbooks"),
  createWorldbook: (payload: Partial<WorldBook>) =>
    request<WorldBook>("/api/worldbooks", { method: "POST", body: JSON.stringify(payload) }),
  importWorldbook: (file: File) => upload<WorldBook>("/api/worldbooks/import", file),
  importChubWorldbook: (url_or_path: string) =>
    request<WorldBook>("/api/worldbooks/import/chub", { method: "POST", body: JSON.stringify({ url_or_path }) }),
  updateWorldbook: (worldbookId: string, payload: Partial<WorldBook>) =>
    request<WorldBook>(`/api/worldbooks/${worldbookId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteWorldbook: (worldbookId: string) => request<{ ok: boolean }>(`/api/worldbooks/${worldbookId}`, { method: "DELETE" }),
  exportWorldbook: (worldbookId: string, name = "worldbook.json") => download(`/api/worldbooks/${worldbookId}/export`, name),
  folders: () => request<SessionFolder[]>("/api/session-folders"),
  createFolder: (payload: Partial<SessionFolder>) =>
    request<SessionFolder>("/api/session-folders", { method: "POST", body: JSON.stringify(payload) }),
  updateFolder: (folderId: string, payload: Partial<SessionFolder>) =>
    request<SessionFolder>(`/api/session-folders/${folderId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteFolder: (folderId: string) =>
    request<{ ok: boolean }>(`/api/session-folders/${folderId}`, { method: "DELETE" }),
  sessions: (params?: { folder_id?: string; search?: string; archived?: boolean }) => {
    const searchParams = new URLSearchParams();
    if (params?.folder_id) searchParams.set("folder_id", params.folder_id);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.archived !== undefined) searchParams.set("archived", String(params.archived));
    const qs = searchParams.toString();
    return request<ChatSession[]>(`/api/sessions${qs ? "?" + qs : ""}`);
  },
  createSession: (payload: Partial<ChatSession>) =>
    request<ChatSession>("/api/sessions", { method: "POST", body: JSON.stringify(payload) }),
  updateSession: (sessionId: string, payload: Partial<ChatSession>) =>
    request<ChatSession>(`/api/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  tree: (sessionId: string) => request<SessionTree>(`/api/sessions/${sessionId}/tree`),
  appendMessage: (sessionId: string, payload: Partial<Message>) =>
    request<Message>(`/api/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify(payload) }),
  updateMessage: (messageId: string, payload: Partial<Message>) =>
    request<Message>(`/api/messages/${messageId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  selectMessage: (messageId: string) =>
    request<SessionTree>(`/api/messages/${messageId}/select`, { method: "POST", body: "{}" }),
  createSwipe: (messageId: string, payload: { content: string; thinking_content?: string; role?: string; speaker?: string; status?: string }) =>
    request<SessionTree>(`/api/messages/${messageId}/swipes`, { method: "POST", body: JSON.stringify(payload) }),
  contextPreview: (sessionId: string) =>
    request<ContextPreview>(`/api/sessions/${sessionId}/context/preview`, { method: "POST", body: "{}" })
};

export type StreamHandlers = {
  onCreated?: (message: Message) => void;
  onToken?: (messageId: string, delta: string) => void;
  onThinking?: (messageId: string, delta: string) => void;
  onUsage?: (messageId: string, usage: Record<string, unknown>) => void;
  onComplete?: (message: Message) => void;
  onError?: (messageId: string | undefined, detail: string) => void;
};

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  const lines = block.split(/\r?\n/);
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (!eventLine || dataLines.length === 0) return null;
  const event = eventLine.slice(6).trim();
  const dataText = dataLines.map((line) => line.slice(5).trim()).join("\n");
  try {
    return { event, data: JSON.parse(dataText) };
  } catch {
    return null;
  }
}

function dispatchSseEvent(parsed: { event: string; data: unknown }, handlers: StreamHandlers): void {
  if (parsed.event === "message_created") handlers.onCreated?.(parsed.data as Message);
  if (parsed.event === "token") {
    const data = parsed.data as { message_id: string; delta: string };
    handlers.onToken?.(data.message_id, data.delta);
  }
  if (parsed.event === "thinking") {
    const data = parsed.data as { message_id: string; delta: string };
    handlers.onThinking?.(data.message_id, data.delta);
  }
  if (parsed.event === "usage") {
    const data = parsed.data as { message_id: string; usage: Record<string, unknown> };
    handlers.onUsage?.(data.message_id, data.usage);
  }
  if (parsed.event === "message_completed") handlers.onComplete?.(parsed.data as Message);
  if (parsed.event === "error") {
    const data = parsed.data as { message_id?: string; detail: string };
    handlers.onError?.(data.message_id, data.detail);
  }
}

function flushSseBuffer(buffer: string, handlers: StreamHandlers): void {
  if (!buffer.trim()) return;
  const parsed = parseSseBlock(buffer);
  if (parsed) dispatchSseEvent(parsed, handlers);
}

export async function streamGenerate(
  sessionId: string,
  payload: { regenerate_message_id?: string | null; api_profile_id?: string | null },
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/generate/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok || !response.body) {
    notifyAuthenticationRequired(`/api/sessions/${sessionId}/generate/stream`, response);
    throw new Error(await responseError(response));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split(/\n\n/);
      buffer = blocks.pop() || "";
      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (!parsed) continue;
        dispatchSseEvent(parsed, handlers);
      }
    }
    // Flush any remaining content in buffer after stream ends (F5 fix)
    flushSseBuffer(buffer, handlers);
  } finally {
    reader.releaseLock();
  }
}
