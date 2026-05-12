from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    ]


def upgrade() -> None:
    op.create_table(
        "api_profiles",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("provider_type", sa.String(length=40), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=False),
        sa.Column("path_override", sa.String(length=500), nullable=True),
        sa.Column("model", sa.String(length=200), nullable=False),
        sa.Column("api_key_env", sa.String(length=120), nullable=False),
        sa.Column("default_params", sa.JSON(), nullable=False),
        *timestamps(),
    )
    op.create_table(
        "characters",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("personality", sa.Text(), nullable=False),
        sa.Column("scenario", sa.Text(), nullable=False),
        sa.Column("first_mes", sa.Text(), nullable=False),
        sa.Column("mes_example", sa.Text(), nullable=False),
        sa.Column("creator_notes", sa.Text(), nullable=False),
        sa.Column("system_prompt", sa.Text(), nullable=False),
        sa.Column("post_history_instructions", sa.Text(), nullable=False),
        sa.Column("alternate_greetings", sa.JSON(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("creator", sa.String(length=200), nullable=False),
        sa.Column("character_version", sa.String(length=80), nullable=False),
        sa.Column("avatar_data_url", sa.Text(), nullable=True),
        sa.Column("raw_json", sa.JSON(), nullable=False),
        sa.Column("extensions", sa.JSON(), nullable=False),
        sa.Column("character_book", sa.JSON(), nullable=True),
        *timestamps(),
    )
    op.create_table(
        "worldbooks",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("scan_depth", sa.Integer(), nullable=False),
        sa.Column("token_budget", sa.Integer(), nullable=False),
        sa.Column("recursive_scanning", sa.Boolean(), nullable=False),
        sa.Column("raw_json", sa.JSON(), nullable=False),
        *timestamps(),
    )
    op.create_table(
        "sessions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("character_id", sa.String(), sa.ForeignKey("characters.id"), nullable=True),
        sa.Column("api_profile_id", sa.String(), sa.ForeignKey("api_profiles.id"), nullable=True),
        sa.Column("worldbook_id", sa.String(), sa.ForeignKey("worldbooks.id"), nullable=True),
        sa.Column("preset", sa.JSON(), nullable=False),
        sa.Column("active_root_child_id", sa.String(), nullable=True),
        *timestamps(),
    )
    op.create_table(
        "worldbook_entries",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("worldbook_id", sa.String(), sa.ForeignKey("worldbooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("uid", sa.String(length=120), nullable=True),
        sa.Column("keys", sa.JSON(), nullable=False),
        sa.Column("secondary_keys", sa.JSON(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("constant", sa.Boolean(), nullable=False),
        sa.Column("selective", sa.Boolean(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("position", sa.String(length=80), nullable=False),
        sa.Column("depth", sa.Integer(), nullable=True),
        sa.Column("case_sensitive", sa.Boolean(), nullable=False),
        sa.Column("match_whole_words", sa.Boolean(), nullable=False),
        sa.Column("raw_json", sa.JSON(), nullable=False),
        *timestamps(),
    )
    op.create_table(
        "messages",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("parent_id", sa.String(), sa.ForeignKey("messages.id"), nullable=True),
        sa.Column("selected_child_id", sa.String(), nullable=True),
        sa.Column("role", sa.String(length=40), nullable=False),
        sa.Column("speaker", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("provider_metadata", sa.JSON(), nullable=False),
        sa.Column("usage", sa.JSON(), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        *timestamps(),
    )


def downgrade() -> None:
    op.drop_table("messages")
    op.drop_table("worldbook_entries")
    op.drop_table("sessions")
    op.drop_table("worldbooks")
    op.drop_table("characters")
    op.drop_table("api_profiles")
