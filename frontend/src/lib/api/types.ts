import type { components } from "./generated";

export type SillyTavernImportReport = components["schemas"]["SillyTavernImportReport"];
export type ImportedResource = components["schemas"]["ImportedResourceOut"];
export type SavedCredential = components["schemas"]["SavedCredentialOut"];
export type SessionDefaults = components["schemas"]["DefaultSessionConfigOut"];

export type ProviderType = "anthropic_messages" | "openai_chat_completions" | "openai_responses";

type WireProfile = components["schemas"]["APIProfileOut"];
export type APIProfile = Omit<WireProfile, "provider_type" | "default_params" |
  "model_catalog" | "created_at" | "updated_at"> & {
  provider_type: ProviderType;
  default_params: Record<string, unknown>;
  model_catalog: RemoteModelInfo[];
  created_at?: string;
  updated_at?: string;
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
  input_token_limit?: number;
  output_token_limit?: number;
};

export type RemoteModelInfo = {
  id: string;
  display_name?: string | null;
  max_input_tokens?: number | null;
  max_output_tokens?: number | null;
  max_total_tokens?: number | null;
  supports_reasoning?: boolean | null;
  supports_vision?: boolean | null;
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

type WireSession = components["schemas"]["SessionOut"];

// The UI deliberately accepts older in-memory test/session snapshots without these
// server-populated fields. All other fields track the generated response schema.
export type ChatSession = Omit<WireSession, "pinned" | "archived" | "preset" |
  "last_activity_at" | "created_at" | "updated_at"> & {
  pinned?: boolean;
  archived?: boolean;
  preset: Record<string, unknown>;
  last_activity_at?: string;
  created_at?: string;
  updated_at?: string;
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

type WireMessage = components["schemas"]["MessageOut"];

// Pydantic includes defaults in actual responses; the UI treats these fields
// as present and keeps a narrower role union than OpenAPI's pattern-based string.
export type Message = Omit<WireMessage, "role" | "provider_metadata" | "usage" |
  "generation_run"> & {
  role: "system" | "user" | "assistant";
  provider_metadata: Record<string, unknown>;
  usage: Record<string, unknown>;
  generation_run?: components["schemas"]["GenerationRunSummaryOut"] | null;
};

type WireSessionTree = components["schemas"]["SessionTreeOut"];
export type SessionTree = Omit<WireSessionTree, "session" | "messages"> & {
  session: ChatSession;
  messages: Message[];
};

export type ContextPreview = {
  system: string;
  messages: Array<{ role: string; speaker: string; content: string }>;
  activated_lore: Array<{ id: string; worldbook_id: string; order: number; position: string; content: string; keys: string[] }>;
  compiled_blocks: CompiledPromptBlock[];
  diagnostics: PromptDiagnostic[];
  worldbook_ids: string[];
  prompt_config_revision: number;
  configured_input_token_limit: number;
  effective_input_token_limit: number;
  configured_output_token_limit: number;
  effective_output_token_limit: number;
  model_max_input_tokens?: number | null;
  model_max_output_tokens?: number | null;
  model_max_total_tokens?: number | null;
  estimated_input_tokens: number;
  dropped_history_count: number;
  dropped_history_tokens: number;
};

export type AuthStatus = {
  enabled: boolean;
  authenticated: boolean;
  username: string | null;
};

export type AuthLogin = components["schemas"]["LoginRequest"];
