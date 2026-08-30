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


class APIProfileCreate(APIProfileBase):
    api_key: Optional[str] = None

    @model_validator(mode="after")
    def require_credential(self) -> "APIProfileCreate":
        if not (self.api_key or "").strip() and not self.api_key_env:
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


class APIProfileOut(APIProfileBase, ORMModel):
    id: str
    has_api_key: bool = False
    created_at: datetime
    updated_at: datetime


class ModelsRefreshOut(BaseModel):
    models: List[str]


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
    depth: Optional[int] = None
    case_sensitive: bool = False
    match_whole_words: bool = False
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
    raw_json: Dict[str, Any] = Field(default_factory=dict)


class WorldBookCreate(WorldBookBase):
    entries: List[WorldBookEntryCreate] = Field(default_factory=list)


class WorldBookUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    scan_depth: Optional[int] = None
    token_budget: Optional[int] = None
    recursive_scanning: Optional[bool] = None
    raw_json: Optional[Dict[str, Any]] = None
    entries: Optional[List[WorldBookEntryCreate]] = None


class WorldBookOut(WorldBookBase, ORMModel):
    id: str
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
    pass


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


class ActivatedLore(BaseModel):
    id: str
    worldbook_id: str
    order: int
    position: str
    content: str
    keys: List[str]


class ContextPreviewOut(BaseModel):
    system: str
    messages: List[PromptMessage]
    activated_lore: List[ActivatedLore]
    compiled_blocks: List[CompiledPromptBlock] = Field(default_factory=list)
    diagnostics: List[PromptDiagnostic] = Field(default_factory=list)
    worldbook_ids: List[str] = Field(default_factory=list)
    prompt_config_revision: int = 0


class GenerateRequest(BaseModel):
    regenerate_message_id: Optional[str] = None


class ChubImportRequest(BaseModel):
    url_or_path: str


class ErrorOut(BaseModel):
    detail: str
