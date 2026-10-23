from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator


class ORMModel(BaseModel):
    model_config = {"from_attributes": True}


class APIProfileBase(BaseModel):
    name: str
    provider_type: str = Field(pattern="^(anthropic_messages|openai_chat_completions|openai_responses)$")
    base_url: str
    path_override: Optional[str] = None
    model: str
    api_key_env: str = Field(default="", pattern=r"^(?:[A-Za-z_][A-Za-z0-9_]*)?$")
    default_params: Dict[str, Any] = Field(default_factory=dict)
    excluded_body_params: List[str] = Field(default_factory=list)
    anthropic_prompt_cache: bool = False
    input_token_limit: int = Field(default=262144, ge=1024, le=8 * 1024 * 1024)
    output_token_limit: int = Field(default=32768, ge=1, le=1024 * 1024)

    @model_validator(mode="after")
    def validate_excluded_body_params(self) -> "APIProfileBase":
        from .services.provider_protocols.request_settings import normalize_excluded_body_params

        self.excluded_body_params = normalize_excluded_body_params(self.excluded_body_params)
        return self


class APIProfileCreate(APIProfileBase):
    api_key: Optional[str] = None
    custom_headers: Dict[str, str] = Field(default_factory=dict, json_schema_extra={"writeOnly": True})

    @model_validator(mode="after")
    def require_credential(self) -> "APIProfileCreate":
        from .services.provider_protocols.request_settings import has_custom_auth, normalize_custom_headers, validate_body_params

        validate_body_params(self.default_params)
        self.custom_headers = normalize_custom_headers(self.custom_headers)
        if not (self.api_key or "").strip() and not self.api_key_env and not has_custom_auth(self.custom_headers):
            raise ValueError("请填写 API Key")
        return self


class APIProfileUpdate(BaseModel):
    name: Optional[str] = None
    provider_type: Optional[str] = Field(default=None, pattern="^(anthropic_messages|openai_chat_completions|openai_responses)$")
    base_url: Optional[str] = None
    path_override: Optional[str] = None
    model: Optional[str] = None
    # An omitted key keeps the stored credential; an empty string clears it.
    api_key: Optional[str] = None
    api_key_env: Optional[str] = Field(default=None, pattern=r"^(?:[A-Za-z_][A-Za-z0-9_]*)?$")
    default_params: Optional[Dict[str, Any]] = None
    custom_headers: Dict[str, Optional[str]] = Field(default_factory=dict, json_schema_extra={"writeOnly": True})
    excluded_body_params: Optional[List[str]] = None
    anthropic_prompt_cache: Optional[bool] = None
    input_token_limit: Optional[int] = Field(default=None, ge=1024, le=8 * 1024 * 1024)
    output_token_limit: Optional[int] = Field(default=None, ge=1, le=1024 * 1024)

    @model_validator(mode="after")
    def validate_request_customizations(self) -> "APIProfileUpdate":
        from .services.provider_protocols.request_settings import normalize_custom_headers, normalize_excluded_body_params, validate_body_params

        if "default_params" in self.model_fields_set:
            validate_body_params(self.default_params)
        if "custom_headers" in self.model_fields_set:
            self.custom_headers = normalize_custom_headers(self.custom_headers, allow_deletions=True)
        if "excluded_body_params" in self.model_fields_set:
            if self.excluded_body_params is None:
                raise ValueError("排除的正文参数必须是字段名列表")
            self.excluded_body_params = normalize_excluded_body_params(self.excluded_body_params)
        if "anthropic_prompt_cache" in self.model_fields_set and self.anthropic_prompt_cache is None:
            raise ValueError("Anthropic 提示词缓存开关必须是布尔值")
        return self


class RemoteModelInfo(BaseModel):
    id: str
    display_name: Optional[str] = None
    max_input_tokens: Optional[int] = None
    max_output_tokens: Optional[int] = None
    max_total_tokens: Optional[int] = None
    supports_reasoning: Optional[bool] = None
    supports_vision: Optional[bool] = None


class APIProfileOut(APIProfileBase, ORMModel):
    id: str
    has_api_key: bool = False
    custom_header_names: List[str] = Field(default_factory=list)
    model_catalog: List[RemoteModelInfo] = Field(default_factory=list)
    models_refreshed_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ModelsRefreshOut(BaseModel):
    models: List[RemoteModelInfo]
    refreshed_at: Optional[datetime] = None
    available: bool = True
    message: Optional[str] = None


class ModelsDiscoverIn(BaseModel):
    provider_type: str = Field(pattern="^(anthropic_messages|openai_chat_completions|openai_responses)$")
    base_url: str
    path_override: Optional[str] = None
    api_key: Optional[str] = None
    profile_id: Optional[str] = None
    custom_headers: Dict[str, Optional[str]] = Field(default_factory=dict, json_schema_extra={"writeOnly": True})

    @model_validator(mode="after")
    def validate_discovery_headers(self) -> "ModelsDiscoverIn":
        from .services.provider_protocols.request_settings import normalize_custom_headers

        self.custom_headers = normalize_custom_headers(self.custom_headers, allow_deletions=True)
        return self


class CharacterBase(BaseModel):
    name: str
    description: str = ""
    personality: str = ""
    scenario: str = ""
    first_mes: str = ""
    mes_example: str = ""
    creator_notes: str = ""
    system_prompt: str = ""
    post_history_instructions: str = ""
    alternate_greetings: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    creator: str = ""
    character_version: str = ""
    avatar_data_url: Optional[str] = None
    avatar_original_data_url: Optional[str] = None
    avatar_transform: Dict[str, Any] = Field(default_factory=dict)
    raw_json: Dict[str, Any] = Field(default_factory=dict)
    extensions: Dict[str, Any] = Field(default_factory=dict)
    character_book: Optional[Dict[str, Any]] = None


class CharacterCreate(CharacterBase):
    pass


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    personality: Optional[str] = None
    scenario: Optional[str] = None
    first_mes: Optional[str] = None
    mes_example: Optional[str] = None
    creator_notes: Optional[str] = None
    system_prompt: Optional[str] = None
    post_history_instructions: Optional[str] = None
    alternate_greetings: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    creator: Optional[str] = None
    character_version: Optional[str] = None
    avatar_data_url: Optional[str] = None
    avatar_original_data_url: Optional[str] = None
    avatar_transform: Optional[Dict[str, Any]] = None
    raw_json: Optional[Dict[str, Any]] = None
    extensions: Optional[Dict[str, Any]] = None
    character_book: Optional[Dict[str, Any]] = None


class CharacterOut(CharacterBase, ORMModel):
    id: str
    import_warnings: List[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class WorldBookEntryBase(BaseModel):
    uid: Optional[str] = None
    keys: List[str] = Field(default_factory=list)
    secondary_keys: List[str] = Field(default_factory=list)
    content: str = ""
    enabled: bool = True
    constant: bool = False
    selective: bool = False
    order: int = 100
    position: str = "after_char"
    depth: Optional[int] = Field(default=None, ge=0)
    case_sensitive: bool = False
    match_whole_words: bool = False
    exclude_recursion: bool = False
    prevent_recursion: bool = False
    delay_until_recursion: int = Field(default=0, ge=0)
    raw_json: Dict[str, Any] = Field(default_factory=dict)


class WorldBookEntryCreate(WorldBookEntryBase):
    pass


class WorldBookEntryOut(WorldBookEntryBase, ORMModel):
    id: str
    worldbook_id: str
    created_at: datetime
    updated_at: datetime


class WorldBookBase(BaseModel):
    name: str
    description: str = ""
    scan_depth: int = 8
    token_budget: int = 4000
    recursive_scanning: bool = False
    max_recursion_steps: int = Field(default=0, ge=0)
    raw_json: Dict[str, Any] = Field(default_factory=dict)


class WorldBookCreate(WorldBookBase):
    entries: List[WorldBookEntryCreate] = Field(default_factory=list)


class WorldBookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    scan_depth: Optional[int] = None
    token_budget: Optional[int] = None
    recursive_scanning: Optional[bool] = None
    max_recursion_steps: Optional[int] = Field(default=None, ge=0)
    raw_json: Optional[Dict[str, Any]] = None
    entries: Optional[List[WorldBookEntryCreate]] = None


class WorldBookOut(WorldBookBase, ORMModel):
    id: str
    import_warnings: List[str] = Field(default_factory=list)
    entries: List[WorldBookEntryOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class SessionFolderBase(BaseModel):
    name: str
    parent_id: Optional[str] = None
    sort_order: int = 0


class SessionFolderCreate(SessionFolderBase):
    pass


class SessionFolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[str] = None
    sort_order: Optional[int] = None


class SessionFolderOut(SessionFolderBase, ORMModel):
    id: str
    created_at: datetime
    updated_at: datetime


PromptSlotKind = Literal[
    "main",
    "world_before",
    "char_description",
    "char_personality",
    "scenario",
    "examples",
    "pre_history",
    "history",
    "world_after",
    "post_history",
    "custom",
]
PromptRole = Literal["system", "user", "assistant"]


class PromptSlot(BaseModel):
    model_config = {"extra": "forbid"}

    id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_.:-]+$")
    kind: PromptSlotKind
    name: str = Field(min_length=1, max_length=200)
    enabled: bool = True
    role: PromptRole = "system"
    # None follows the live character/session/worldbook source; a string is a
    # global explicit override shared by every session.
    content: Optional[str] = None


class GlobalPromptConfigOut(BaseModel):
    prompt_slots: List[PromptSlot]
    revision: int = 0
    updated_at: Optional[datetime] = None


class GlobalPromptConfigUpdate(BaseModel):
    prompt_slots: List[PromptSlot]
    expected_revision: int = Field(ge=0)


class TtsSettingsBase(BaseModel):
    model_config = {"extra": "forbid"}

    enabled: bool = False
    provider: Literal["minimax", "openai_compatible"] = "minimax"
    endpoint: str = Field(default="https://api.minimax.cn/v1/t2a_v2", max_length=1000)
    model: str = Field(default="speech-2.8-hd", max_length=200)
    voice: str = Field(default="", max_length=200)
    speed: float = Field(default=1.0, ge=0.25, le=4.0, allow_inf_nan=False)
    volume: float = Field(default=1.0, gt=0, le=10, allow_inf_nan=False)
    pitch: int = Field(default=0, ge=-12, le=12)
    emotion: str = Field(default="", max_length=80)
    language_boost: str = Field(default="auto", max_length=80)
    text_mode: Literal["dialogue", "tags"] = "dialogue"
    trigger_mode: Literal["manual", "auto"] = "manual"
    instruct_model: bool = True


class TtsSettingsUpdate(TtsSettingsBase):
    expected_revision: int = Field(ge=0)
    # Empty/omitted values preserve the credential. Removal is always explicit.
    api_key: Optional[str] = Field(default=None, max_length=8192, pattern=r"^[^\r\n]*$")
    clear_api_key: bool = False


class TtsSettingsOut(TtsSettingsBase, ORMModel):
    revision: int = 0
    has_api_key: bool = False


class TtsPreviewRequest(BaseModel):
    model_config = {"extra": "forbid"}
    mode: Optional[Literal["dialogue", "tags"]] = None


class TtsPreviewOut(BaseModel):
    message_id: str
    text: str
    segments: List[str]
    warnings: List[str]
    max_characters: int


class TtsGenerateRequest(BaseModel):
    model_config = {"extra": "forbid"}
    text: Optional[str] = Field(default=None, max_length=9999)


class TtsVoiceOut(BaseModel):
    id: str
    name: str
    description: str = ""
    kind: str


class TtsVoicesOut(BaseModel):
    voices: List[TtsVoiceOut]


class SillyTavernPreviewRequest(BaseModel):
    ssh_host: str = Field(min_length=1, max_length=200)
    directory: str = Field(default="~/SillyTavern", min_length=1, max_length=2048)
    user: str = Field(default="default-user", min_length=1, max_length=120)


class SillyTavernApplyRequest(BaseModel):
    token: str = Field(min_length=1, max_length=120)
    activate: bool = False


class SillyTavernImportReport(BaseModel):
    source: str
    counts: Dict[str, int]
    already_imported: Dict[str, int]
    warnings: List[str]
    errors: List[str]
    omitted: Dict[str, Any]
    can_apply: bool
    token: Optional[str] = None
    created: Dict[str, int] = Field(default_factory=dict)
    activated: bool = False
    backup_path: Optional[str] = None


class ImportedResourceOut(ORMModel):
    id: str
    source: str
    kind: str
    name: str
    raw_json: Dict[str, Any]
    converted: Dict[str, Any]
    warnings: List[str]


class SavedCredentialOut(ORMModel):
    id: str
    name: str
    secret_type: str


class BindCredentialRequest(BaseModel):
    credential_id: str


class DefaultSessionConfigOut(BaseModel):
    preset: Dict[str, Any] = Field(default_factory=dict)
    api_profile_id: Optional[str] = None


RegexTarget = Literal["display", "outgoing_prompt", "user_input", "assistant_output"]


class RegexRule(BaseModel):
    model_config = {"extra": "forbid"}

    id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9_.:-]+$")
    name: str = Field(default="", max_length=200)
    enabled: bool = True
    scope: Literal["session", "character", "global"] = "session"
    targets: List[RegexTarget] = Field(default_factory=lambda: ["display"], min_length=1)
    mode: Literal["replace", "veil"] = "replace"
    pattern: str = Field(min_length=1)
    flags: str = Field(default="", pattern=r"^[gims]*$")
    replacement: str = ""


class GlobalWorldbookRegexConfigOut(BaseModel):
    worldbook_ids: List[str]
    regex_rules: List[RegexRule]
    revision: int = 0
    updated_at: Optional[datetime] = None


class GlobalWorldbookRegexConfigUpdate(BaseModel):
    worldbook_ids: List[str]
    regex_rules: List[Dict[str, Any]]
    expected_revision: int = Field(ge=0)


class PromptDiagnostic(BaseModel):
    level: Literal["info", "warning", "error"]
    code: str
    message: str
    slot_id: Optional[str] = None
    rule_id: Optional[str] = None
    match_count: Optional[int] = None


class SessionBase(BaseModel):
    title: str
    character_id: Optional[str] = None
    api_profile_id: Optional[str] = None
    worldbook_id: Optional[str] = None
    folder_id: Optional[str] = None
    pinned: bool = False
    archived: bool = False
    preset: Dict[str, Any] = Field(default_factory=dict)
    active_root_child_id: Optional[str] = None


class SessionCreate(SessionBase):
    title: str = ""
    character_id: str = Field(min_length=1)


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    character_id: Optional[str] = None
    api_profile_id: Optional[str] = None
    worldbook_id: Optional[str] = None
    folder_id: Optional[str] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None
    preset: Optional[Dict[str, Any]] = None
    active_root_child_id: Optional[str] = None


class SessionOut(SessionBase, ORMModel):
    id: str
    last_activity_at: datetime
    created_at: datetime
    updated_at: datetime


class MessageBase(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    speaker: str = ""
    content: str = ""
    thinking_content: str = ""
    status: str = Field(default="complete", pattern="^(complete|streaming|failed|interrupted|cancelled)$")
    token_count: int = 0
    thinking_token_count: int = 0
    cached_tokens: int = 0
    provider_metadata: Dict[str, Any] = Field(default_factory=dict)
    usage: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


class MessageCreate(MessageBase):
    parent_id: Optional[str] = None


class MessageUpdate(BaseModel):
    role: Optional[Literal["system", "user", "assistant"]] = None
    content: Optional[str] = None
    thinking_content: Optional[str] = None
    speaker: Optional[str] = None
    status: Optional[str] = Field(default=None, pattern="^(complete|streaming|failed|interrupted|cancelled)$")
    token_count: Optional[int] = None
    thinking_token_count: Optional[int] = None
    cached_tokens: Optional[int] = None
    provider_metadata: Optional[Dict[str, Any]] = None
    usage: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class SwipeCreate(BaseModel):
    role: Optional[str] = Field(default=None, pattern="^(system|user|assistant)$")
    speaker: Optional[str] = None
    content: str = ""
    thinking_content: str = ""
    status: str = Field(default="complete", pattern="^(complete|streaming|failed|interrupted|cancelled)$")


class GenerationRunSummaryOut(ORMModel):
    id: str
    session_id: str
    output_message_id: Optional[str] = None
    profile_name: str
    provider_type: str
    model: str
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    duration_seconds: float
    error: Optional[str] = None
    usage_source: str
    input_tokens: int
    output_tokens: int
    cached_input_tokens: int
    tokens_per_second: float


class GenerationRunOut(GenerationRunSummaryOut):
    base_message_id: Optional[str] = None
    api_profile_id: Optional[str] = None
    base_url: str
    parameters: Dict[str, Any]
    prompt_snapshot: Dict[str, Any]
    prompt_hash: str
    first_token_at: Optional[datetime] = None
    usage: Dict[str, Any]
    created_at: datetime
    updated_at: datetime


class CharacterSummaryOut(ORMModel):
    id: str
    name: str
    avatar_data_url: Optional[str] = None
    avatar_transform: Dict[str, Any] = Field(default_factory=dict)
    tags: List[str] = Field(default_factory=list)
    creator: str = ""
    character_version: str = ""
    updated_at: datetime


class MessageOut(MessageBase, ORMModel):
    id: str
    session_id: str
    parent_id: Optional[str] = None
    selected_child_id: Optional[str] = None
    sort_order: int
    generation_run: Optional[GenerationRunSummaryOut] = None
    created_at: datetime
    updated_at: datetime


class SessionTreeOut(BaseModel):
    session: SessionOut
    messages: List[MessageOut]
    active_path_ids: List[str]


class MessageTreeMutationOut(SessionTreeOut):
    deleted_count: int


class PromptMessage(BaseModel):
    role: str
    content: str
    speaker: str = ""


class CompiledPromptBlock(BaseModel):
    slot_id: str
    slot_kind: PromptSlotKind
    slot_name: str
    source: str
    role: PromptRole
    content: str
    token_count: int
    is_history: bool = False
    message_id: Optional[str] = None
    speaker: str = ""


class LoreTrigger(BaseModel):
    id: str
    worldbook_id: str


class ActivatedLore(BaseModel):
    id: str
    worldbook_id: str
    order: int
    position: str
    content: str
    keys: List[str]
    activation_reason: Literal["message", "constant", "recursion", "recursion_delay"] = "message"
    recursion_step: int = 0
    triggered_by: List[LoreTrigger] = Field(default_factory=list)


class ContextPreviewOut(BaseModel):
    system: str
    messages: List[PromptMessage]
    activated_lore: List[ActivatedLore]
    compiled_blocks: List[CompiledPromptBlock] = Field(default_factory=list)
    diagnostics: List[PromptDiagnostic] = Field(default_factory=list)
    worldbook_ids: List[str] = Field(default_factory=list)
    prompt_config_revision: int = 0
    configured_input_token_limit: int = 262144
    effective_input_token_limit: int = 262144
    configured_output_token_limit: int = 32768
    effective_output_token_limit: int = 32768
    model_max_input_tokens: Optional[int] = None
    model_max_output_tokens: Optional[int] = None
    model_max_total_tokens: Optional[int] = None
    estimated_input_tokens: int = 0
    dropped_history_count: int = 0
    dropped_history_tokens: int = 0


class ContextPreviewRequest(BaseModel):
    api_profile_id: Optional[str] = None


class GenerateRequest(BaseModel):
    regenerate_message_id: Optional[str] = None
    api_profile_id: Optional[str] = None


class ChubImportRequest(BaseModel):
    url_or_path: str


class ErrorOut(BaseModel):
    detail: str
