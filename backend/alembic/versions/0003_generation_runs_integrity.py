from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_generation_runs_integrity"
down_revision = "0002_message_tokens_thinking"
branch_labels = None
depends_on = None


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _foreign_key_columns(table_name: str) -> set[tuple[str, ...]]:
    return {
        tuple(foreign_key.get("constrained_columns") or [])
        for foreign_key in sa.inspect(op.get_bind()).get_foreign_keys(table_name)
    }


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "session_folders" not in tables:
        op.create_table(
            "session_folders",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("parent_id", sa.String(), sa.ForeignKey("session_folders.id", ondelete="CASCADE"), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        )

    # Older runtime-managed schemas could contain dangling selection/folder
    # pointers because SQLite foreign keys were disabled. Heal them before the
    # batch rebuild adds constraints.
    op.execute(
        sa.text(
            "UPDATE sessions SET active_root_child_id = NULL "
            "WHERE active_root_child_id IS NOT NULL AND NOT EXISTS ("
            "SELECT 1 FROM messages child WHERE child.id = sessions.active_root_child_id "
            "AND child.session_id = sessions.id AND child.parent_id IS NULL)"
        )
    )
    op.execute(
        sa.text(
            "UPDATE messages SET selected_child_id = NULL "
            "WHERE selected_child_id IS NOT NULL AND NOT EXISTS ("
            "SELECT 1 FROM messages child WHERE child.id = messages.selected_child_id "
            "AND child.session_id = messages.session_id AND child.parent_id = messages.id)"
        )
    )

    session_columns = _columns("sessions")
    session_fks = _foreign_key_columns("sessions")
    with op.batch_alter_table("sessions") as batch:
        if "folder_id" not in session_columns:
            batch.add_column(sa.Column("folder_id", sa.String(), nullable=True))
        if "pinned" not in session_columns:
            batch.add_column(sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
        if "archived" not in session_columns:
            batch.add_column(sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()))
        if "last_activity_at" not in session_columns:
            batch.add_column(
                sa.Column(
                    "last_activity_at",
                    sa.DateTime(timezone=True),
                    nullable=False,
                    server_default=sa.text("CURRENT_TIMESTAMP"),
                )
            )
        if ("folder_id",) not in session_fks:
            batch.create_foreign_key(
                "fk_sessions_folder_id_session_folders",
                "session_folders",
                ["folder_id"],
                ["id"],
                ondelete="SET NULL",
            )
        if ("active_root_child_id",) not in session_fks:
            batch.create_foreign_key(
                "fk_sessions_active_root_child_id_messages",
                "messages",
                ["active_root_child_id"],
                ["id"],
                ondelete="SET NULL",
            )

    character_columns = _columns("characters")
    with op.batch_alter_table("characters") as batch:
        if "avatar_original_data_url" not in character_columns:
            batch.add_column(sa.Column("avatar_original_data_url", sa.Text(), nullable=True))
        if "avatar_transform" not in character_columns:
            batch.add_column(
                sa.Column("avatar_transform", sa.JSON(), nullable=False, server_default=sa.text("'{}'"))
            )

    message_fks = _foreign_key_columns("messages")
    if ("selected_child_id",) not in message_fks:
        with op.batch_alter_table("messages") as batch:
            batch.create_foreign_key(
                "fk_messages_selected_child_id_messages",
                "messages",
                ["selected_child_id"],
                ["id"],
                ondelete="SET NULL",
            )

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "generation_runs" not in tables:
        op.create_table(
            "generation_runs",
            sa.Column("id", sa.String(), primary_key=True),
            sa.Column("session_id", sa.String(), sa.ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("base_message_id", sa.String(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
            sa.Column("output_message_id", sa.String(), sa.ForeignKey("messages.id", ondelete="SET NULL"), nullable=True),
            sa.Column("api_profile_id", sa.String(), sa.ForeignKey("api_profiles.id", ondelete="SET NULL"), nullable=True),
            sa.Column("profile_name", sa.String(length=120), nullable=False, server_default=""),
            sa.Column("provider_type", sa.String(length=40), nullable=False),
            sa.Column("base_url", sa.String(length=500), nullable=False, server_default=""),
            sa.Column("model", sa.String(length=200), nullable=False),
            sa.Column("parameters", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("prompt_snapshot", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("prompt_hash", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=40), nullable=False, server_default="streaming"),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("first_token_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("duration_seconds", sa.Float(), nullable=False, server_default="0"),
            sa.Column("error", sa.Text(), nullable=True),
            sa.Column("usage", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
            sa.Column("usage_source", sa.String(length=40), nullable=False, server_default="estimated"),
            sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("cached_input_tokens", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("tokens_per_second", sa.Float(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.UniqueConstraint("output_message_id", name="uq_generation_runs_output_message_id"),
        )
        op.create_index("ix_generation_runs_session_id", "generation_runs", ["session_id"])
        op.create_index("ix_generation_runs_prompt_hash", "generation_runs", ["prompt_hash"])
        op.create_index("ix_generation_runs_status", "generation_runs", ["status"])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "generation_runs" in tables:
        op.drop_index("ix_generation_runs_status", table_name="generation_runs")
        op.drop_index("ix_generation_runs_prompt_hash", table_name="generation_runs")
        op.drop_index("ix_generation_runs_session_id", table_name="generation_runs")
        op.drop_table("generation_runs")

    with op.batch_alter_table("messages") as batch:
        batch.drop_constraint("fk_messages_selected_child_id_messages", type_="foreignkey")

    character_columns = _columns("characters")
    with op.batch_alter_table("characters") as batch:
        if "avatar_transform" in character_columns:
            batch.drop_column("avatar_transform")
        if "avatar_original_data_url" in character_columns:
            batch.drop_column("avatar_original_data_url")

    session_columns = _columns("sessions")
    with op.batch_alter_table("sessions") as batch:
        batch.drop_constraint("fk_sessions_active_root_child_id_messages", type_="foreignkey")
        batch.drop_constraint("fk_sessions_folder_id_session_folders", type_="foreignkey")
        if "last_activity_at" in session_columns:
            batch.drop_column("last_activity_at")
        if "archived" in session_columns:
            batch.drop_column("archived")
        if "pinned" in session_columns:
            batch.drop_column("pinned")
        if "folder_id" in session_columns:
            batch.drop_column("folder_id")

    if "session_folders" in tables:
        op.drop_table("session_folders")
