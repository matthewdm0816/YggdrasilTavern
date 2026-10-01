import type {
  CharacterCreateInput, CharacterUpdateInput, ChubImportInput, ContextPreviewInput, FolderCreateInput,
  FolderUpdateInput, MessageCreateInput, MessageUpdateInput, ProfileCreateInput,
  ProfileUpdateInput, PromptConfigUpdateInput, SessionCreateInput, SessionUpdateInput,
  SwipeCreateInput, WorldBookCreateInput, WorldBookUpdateInput
} from "./contracts";
import { download, request, upload } from "./http";
import type {
  APIProfile, AuthLogin, AuthStatus, Character, CharacterSummary,
  ChatSession, ContextPreview, GlobalPromptConfig, Message,
  RemoteModelInfo, SessionFolder, SessionTree, WorldBook
} from "./types";
export const api = {
  authStatus: () => request<AuthStatus>("/api/auth/status"),
  authLogin: (payload: AuthLogin) =>
    request<AuthStatus>("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  authLogout: () => request<AuthStatus>("/api/auth/logout", { method: "POST", body: "{}" }),
  profiles: () => request<APIProfile[]>("/api/api-profiles"),
  createProfile: (payload: ProfileCreateInput) =>
    request<APIProfile>("/api/api-profiles", { method: "POST", body: JSON.stringify(payload) }),
  updateProfile: (profileId: string, payload: ProfileUpdateInput) =>
    request<APIProfile>(`/api/api-profiles/${profileId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteProfile: (profileId: string) =>
    request<{ ok: boolean }>(`/api/api-profiles/${profileId}`, { method: "DELETE" }),
  refreshProfileModels: (profileId: string) =>
    request<{ models: RemoteModelInfo[]; refreshed_at: string }>(`/api/api-profiles/${profileId}/models/refresh`, { method: "POST", body: "{}" }),
  globalPromptConfig: () => request<GlobalPromptConfig>("/api/settings/prompt"),
  updateGlobalPromptConfig: (payload: PromptConfigUpdateInput) =>
    request<GlobalPromptConfig>("/api/settings/prompt", { method: "PUT", body: JSON.stringify(payload) }),
  characters: () => request<CharacterSummary[]>("/api/characters"),
  character: (characterId: string) => request<Character>(`/api/characters/${characterId}`),
  createCharacter: (payload: CharacterCreateInput) =>
    request<Character>("/api/characters", { method: "POST", body: JSON.stringify(payload) }),
  importCharacter: (file: File) => upload<Character>("/api/characters/import", file),
  importChubCharacter: (url_or_path: string) =>
    request<Character>("/api/characters/import/chub", { method: "POST", body: JSON.stringify({ url_or_path } satisfies ChubImportInput) }),
  updateCharacter: (characterId: string, payload: CharacterUpdateInput) =>
    request<Character>(`/api/characters/${characterId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCharacter: (characterId: string) => request<{ ok: boolean }>(`/api/characters/${characterId}`, { method: "DELETE" }),
  exportCharacter: (characterId: string, name = "character.json") => download(`/api/characters/${characterId}/export`, name),
  worldbooks: () => request<WorldBook[]>("/api/worldbooks"),
  createWorldbook: (payload: WorldBookCreateInput) =>
    request<WorldBook>("/api/worldbooks", { method: "POST", body: JSON.stringify(payload) }),
  importWorldbook: (file: File) => upload<WorldBook>("/api/worldbooks/import", file),
  importChubWorldbook: (url_or_path: string) =>
    request<WorldBook>("/api/worldbooks/import/chub", { method: "POST", body: JSON.stringify({ url_or_path } satisfies ChubImportInput) }),
  updateWorldbook: (worldbookId: string, payload: WorldBookUpdateInput) =>
    request<WorldBook>(`/api/worldbooks/${worldbookId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteWorldbook: (worldbookId: string) => request<{ ok: boolean }>(`/api/worldbooks/${worldbookId}`, { method: "DELETE" }),
  exportWorldbook: (worldbookId: string, name = "worldbook.json") => download(`/api/worldbooks/${worldbookId}/export`, name),
  folders: () => request<SessionFolder[]>("/api/session-folders"),
  createFolder: (payload: FolderCreateInput) =>
    request<SessionFolder>("/api/session-folders", { method: "POST", body: JSON.stringify(payload) }),
  updateFolder: (folderId: string, payload: FolderUpdateInput) =>
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
  createSession: (payload: SessionCreateInput) =>
    request<ChatSession>("/api/sessions", { method: "POST", body: JSON.stringify(payload) }),
  updateSession: (sessionId: string, payload: SessionUpdateInput) =>
    request<ChatSession>(`/api/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  tree: (sessionId: string) => request<SessionTree>(`/api/sessions/${sessionId}/tree`),
  appendMessage: (sessionId: string, payload: MessageCreateInput) =>
    request<Message>(`/api/sessions/${sessionId}/messages`, { method: "POST", body: JSON.stringify(payload) }),
  updateMessage: (messageId: string, payload: MessageUpdateInput) =>
    request<Message>(`/api/messages/${messageId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  selectMessage: (messageId: string) =>
    request<SessionTree>(`/api/messages/${messageId}/select`, { method: "POST", body: "{}" }),
  createSwipe: (messageId: string, payload: SwipeCreateInput) =>
    request<SessionTree>(`/api/messages/${messageId}/swipes`, { method: "POST", body: JSON.stringify(payload) }),
  contextPreview: (sessionId: string, apiProfileId?: string | null) =>
    request<ContextPreview>(`/api/sessions/${sessionId}/context/preview`, {
      method: "POST",
      body: JSON.stringify({ api_profile_id: apiProfileId || null } satisfies ContextPreviewInput)
    })
};
