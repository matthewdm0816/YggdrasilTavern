from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def uuid_str() -> str:
    return str(uuid.uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utc_now,
        onupdate=utc_now,
        nullable=False,
    )


class APIProfile(TimestampMixin, Base):
    __tablename__ = "api_profiles"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    provider_type: Mapped[str] = mapped_column(String(40), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), nullable=False)
    path_override: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    # Direct credentials are intentionally write-only at the API layer.  The
    # legacy environment variable remains available for existing profiles, but
    # the desktop UI stores a key here so changing a profile takes effect
    # immediately without restarting the application.
    api_key: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    api_key_env: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    default_params: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    input_token_limit: Mapped[int] = mapped_column(Integer, default=262144, nullable=False)
    output_token_limit: Mapped[int] = mapped_column(Integer, default=32768, nullable=False)
    model_catalog: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    models_refreshed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def has_api_key(self) -> bool:
        return bool(self.api_key)


class GlobalPromptConfig(TimestampMixin, Base):
    __tablename__ = "global_prompt_config"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default="default")
    prompt_slots: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, default=1, nullable=False)


class Character(TimestampMixin, Base):
    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    personality: Mapped[str] = mapped_column(Text, default="", nullable=False)
    scenario: Mapped[str] = mapped_column(Text, default="", nullable=False)
    first_mes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    mes_example: Mapped[str] = mapped_column(Text, default="", nullable=False)
    creator_notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    post_history_instructions: Mapped[str] = mapped_column(Text, default="", nullable=False)
    alternate_greetings: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    creator: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    character_version: Mapped[str] = mapped_column(String(80), default="", nullable=False)
    avatar_data_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    avatar_original_data_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    avatar_transform: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    extensions: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    character_book: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)

    sessions: Mapped[list["ChatSession"]] = relationship(back_populates="character")


class WorldBook(TimestampMixin, Base):
    __tablename__ = "worldbooks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    scan_depth: Mapped[int] = mapped_column(Integer, default=8, nullable=False)
    token_budget: Mapped[int] = mapped_column(Integer, default=4000, nullable=False)
    recursive_scanning: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    entries: Mapped[list["WorldBookEntry"]] = relationship(
        back_populates="worldbook",
        cascade="all, delete-orphan",
        order_by="WorldBookEntry.order",
    )


class WorldBookEntry(TimestampMixin, Base):
    __tablename__ = "worldbook_entries"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    worldbook_id: Mapped[str] = mapped_column(ForeignKey("worldbooks.id", ondelete="CASCADE"), nullable=False)
    uid: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    keys: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    secondary_keys: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    constant: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    selective: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    order: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    position: Mapped[str] = mapped_column(String(80), default="after_char", nullable=False)
    depth: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    case_sensitive: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    match_whole_words: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    worldbook: Mapped[WorldBook] = relationship(back_populates="entries")


class SessionFolder(TimestampMixin, Base):
    __tablename__ = "session_folders"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column(ForeignKey("session_folders.id", ondelete="CASCADE"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    children: Mapped[list["SessionFolder"]] = relationship(
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="SessionFolder.sort_order",
    )
    parent: Mapped[Optional["SessionFolder"]] = relationship(remote_side=[id], back_populates="children")
    sessions: Mapped[list["ChatSession"]] = relationship(back_populates="folder")


class ChatSession(TimestampMixin, Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    character_id: Mapped[Optional[str]] = mapped_column(ForeignKey("characters.id", ondelete="SET NULL"), nullable=True)
    api_profile_id: Mapped[Optional[str]] = mapped_column(ForeignKey("api_profiles.id", ondelete="SET NULL"), nullable=True)
    worldbook_id: Mapped[Optional[str]] = mapped_column(ForeignKey("worldbooks.id", ondelete="SET NULL"), nullable=True)
    folder_id: Mapped[Optional[str]] = mapped_column(ForeignKey("session_folders.id", ondelete="SET NULL"), nullable=True)
    pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    preset: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    active_root_child_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey(
            "messages.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_sessions_active_root_child_id_messages",
        ),
        nullable=True,
    )
    last_activity_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    character: Mapped[Optional[Character]] = relationship(back_populates="sessions")
    api_profile: Mapped[Optional[APIProfile]] = relationship()
    worldbook: Mapped[Optional[WorldBook]] = relationship()
    folder: Mapped[Optional[SessionFolder]] = relationship(back_populates="sessions")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        foreign_keys="Message.session_id",
    )
    generation_runs: Mapped[list["GenerationRun"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        foreign_keys="GenerationRun.session_id",
    )


class Message(TimestampMixin, Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column(ForeignKey("messages.id"), nullable=True)
    selected_child_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL", name="fk_messages_selected_child_id_messages"),
        nullable=True,
    )
    role: Mapped[str] = mapped_column(String(40), nullable=False)
    speaker: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    thinking_content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="complete", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    thinking_token_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cached_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    provider_metadata: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    usage: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    session: Mapped[ChatSession] = relationship(back_populates="messages", foreign_keys=[session_id])
    parent: Mapped[Optional["Message"]] = relationship(
        remote_side=[id], back_populates="children", foreign_keys=[parent_id]
    )
    children: Mapped[list["Message"]] = relationship(
        back_populates="parent",
        cascade="all, delete-orphan",
        order_by="Message.sort_order",
        foreign_keys=[parent_id],
    )
    generation_run: Mapped[Optional["GenerationRun"]] = relationship(
        back_populates="output_message",
        foreign_keys="GenerationRun.output_message_id",
        uselist=False,
    )


class GenerationRun(TimestampMixin, Base):
    __tablename__ = "generation_runs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=uuid_str)
    session_id: Mapped[str] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    base_message_id: Mapped[Optional[str]] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), nullable=True)
    output_message_id: Mapped[Optional[str]] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, unique=True
    )
    api_profile_id: Mapped[Optional[str]] = mapped_column(ForeignKey("api_profiles.id", ondelete="SET NULL"), nullable=True)
    profile_name: Mapped[str] = mapped_column(String(120), default="", nullable=False)
    provider_type: Mapped[str] = mapped_column(String(40), nullable=False)
    base_url: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    parameters: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    prompt_snapshot: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    prompt_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), default="streaming", nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    first_token_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    usage: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    usage_source: Mapped[str] = mapped_column(String(40), default="estimated", nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cached_input_tokens: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_per_second: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    session: Mapped[ChatSession] = relationship(back_populates="generation_runs", foreign_keys=[session_id])
    base_message: Mapped[Optional[Message]] = relationship(foreign_keys=[base_message_id])
    output_message: Mapped[Optional[Message]] = relationship(
        back_populates="generation_run",
        foreign_keys=[output_message_id],
    )
    api_profile: Mapped[Optional[APIProfile]] = relationship(foreign_keys=[api_profile_id])
