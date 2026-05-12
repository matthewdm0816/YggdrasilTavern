from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ORMModel(BaseModel):
    model_config = {"from_attributes": True}


class APIProfileBase(BaseModel):
    name: str
    provider_type: str = Field(pattern="^(anthropic_messages|openai_chat_completions|openai_responses)$")
    base_url: str
    path_override: Optional[str] = None
    model: str
    api_key_env: str
    default_params: Dict[str, Any] = Field(default_factory=dict)


class APIProfileCreate(APIProfileBase):
    pass


class APIProfileUpdate(BaseModel):
    name: Optional[str] = None
    provider_type: Optional[str] = Field(default=None, pattern="^(anthropic_messages|openai_chat_completions|openai_responses)$")
    base_url: Optional[str] = None
    path_override: Optional[str] = None
    model: Optional[str] = None
    api_key_env: Optional[str] = None
    default_params: Optional[Dict[str, Any]] = None


class APIProfileOut(APIProfileBase, ORMModel):
    id: str
    created_at: datetime
    updated_at: datetime


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


class SessionBase(BaseModel):
    title: str
    character_id: Optional[str] = None
    api_profile_id: Optional[str] = None
    worldbook_id: Optional[str] = None
    preset: Dict[str, Any] = Field(default_factory=dict)
    active_root_child_id: Optional[str] = None


class SessionCreate(SessionBase):
    pass


class SessionUpdate(BaseModel):
    title: Optional[str] = None
    character_id: Optional[str] = None
    api_profile_id: Optional[str] = None
    worldbook_id: Optional[str] = None
    preset: Optional[Dict[str, Any]] = None
    active_root_child_id: Optional[str] = None


class SessionOut(SessionBase, ORMModel):
    id: str
    created_at: datetime
    updated_at: datetime


class MessageBase(BaseModel):
    role: str = Field(pattern="^(system|user|assistant)$")
    speaker: str = ""
    content: str = ""
    thinking_content: str = ""
    status: str = "complete"
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
    status: Optional[str] = None
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
    status: str = "complete"


class MessageOut(MessageBase, ORMModel):
    id: str
    session_id: str
    parent_id: Optional[str] = None
    selected_child_id: Optional[str] = None
    sort_order: int
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


class GenerateRequest(BaseModel):
    regenerate_message_id: Optional[str] = None


class ChubImportRequest(BaseModel):
    url_or_path: str


class ErrorOut(BaseModel):
    detail: str
