export type ProviderType = "anthropic_messages" | "openai_chat_completions" | "openai_responses";

export type APIProfile = {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string;
  path_override?: string | null;
  model: string;
  api_key_env: string;
  default_params: Record<string, unknown>;
};

export type Character = {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  alternate_greetings: string[];
  tags: string[];
  avatar_data_url?: string | null;
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
};

export type WorldBook = {
  id: string;
  name: string;
  description: string;
  scan_depth: number;
  token_budget: number;
  entries: WorldBookEntry[];
};

export type ChatSession = {
  id: string;
  title: string;
  character_id?: string | null;
  api_profile_id?: string | null;
  worldbook_id?: string | null;
  preset: Record<string, unknown>;
  active_root_child_id?: string | null;
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
};

const API_BASE = import.meta.env.VITE_API_BASE || "";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`${API_BASE}${path}`, { method: "POST", body: form });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  profiles: () => request<APIProfile[]>("/api/api-profiles"),
  createProfile: (payload: Partial<APIProfile>) =>
    request<APIProfile>("/api/api-profiles", { method: "POST", body: JSON.stringify(payload) }),
  characters: () => request<Character[]>("/api/characters"),
  createCharacter: (payload: Partial<Character>) =>
    request<Character>("/api/characters", { method: "POST", body: JSON.stringify(payload) }),
  importCharacter: (file: File) => upload<Character>("/api/characters/import", file),
  importChubCharacter: (url_or_path: string) =>
    request<Character>("/api/characters/import/chub", { method: "POST", body: JSON.stringify({ url_or_path }) }),
  worldbooks: () => request<WorldBook[]>("/api/worldbooks"),
  createWorldbook: (payload: Partial<WorldBook>) =>
    request<WorldBook>("/api/worldbooks", { method: "POST", body: JSON.stringify(payload) }),
  importWorldbook: (file: File) => upload<WorldBook>("/api/worldbooks/import", file),
  importChubWorldbook: (url_or_path: string) =>
    request<WorldBook>("/api/worldbooks/import/chub", { method: "POST", body: JSON.stringify({ url_or_path }) }),
  sessions: () => request<ChatSession[]>("/api/sessions"),
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

export async function streamGenerate(
  sessionId: string,
  payload: { regenerate_message_id?: string | null },
  handlers: StreamHandlers
): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/generate/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split(/\n\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const parsed = parseSseBlock(block);
      if (!parsed) continue;
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
  }
}
