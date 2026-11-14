"""Add missing foreign-key and query indexes."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0014_foreign_key_and_query_indexes"
down_revision = "0013_parallel_generations"
branch_labels = None
depends_on = None

INDEXES: tuple[tuple[str, str, list[str]], ...] = (
    ("ix_messages_session_id_parent_id_sort_order", "messages", ["session_id", "parent_id", "sort_order"]),
    ("ix_messages_parent_id", "messages", ["parent_id"]),
    ("ix_messages_selected_child_id", "messages", ["selected_child_id"]),
    ("ix_sessions_active_root_child_id", "sessions", ["active_root_child_id"]),
    ("ix_sessions_archived_pinned_last_activity_at", "sessions", ["archived", "pinned", "last_activity_at"]),
    ("ix_sessions_character_id", "sessions", ["character_id"]),
    ("ix_worldbook_entries_worldbook_id", "worldbook_entries", ["worldbook_id"]),
    ("ix_generation_runs_base_message_id", "generation_runs", ["base_message_id"]),
)


def _existing_index_names(table_name: str) -> set[str]:
    return {index["name"] for index in sa.inspect(op.get_bind()).get_indexes(table_name) if index.get("name")}


def upgrade() -> None:
    for index_name, table_name, columns in INDEXES:
        if index_name not in _existing_index_names(table_name):
            op.create_index(index_name, table_name, columns, unique=False)


def downgrade() -> None:
    for index_name, table_name, _columns in reversed(INDEXES):
        if index_name in _existing_index_names(table_name):
            op.drop_index(index_name, table_name=table_name)
