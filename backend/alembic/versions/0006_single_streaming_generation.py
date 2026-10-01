"""Enforce one in-progress generation per chat session."""

from alembic import op
import sqlalchemy as sa


revision = "0006_single_streaming_generation"
down_revision = "0005_profile_token_limits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name not in {"sqlite", "postgresql"}:
        raise RuntimeError("The single-generation constraint requires SQLite or PostgreSQL")
    # Recover conflicting old runs before adding the index. Keep their messages.
    conflicting_sessions = (
        "SELECT session_id FROM generation_runs WHERE status = 'streaming' "
        "GROUP BY session_id HAVING COUNT(*) > 1"
    )
    bind.execute(sa.text(
        "UPDATE messages SET status = 'interrupted', "
        "error = COALESCE(error, 'Overlapping generation recovered during schema upgrade') "
        "WHERE id IN (SELECT output_message_id FROM generation_runs "
        f"WHERE status = 'streaming' AND session_id IN ({conflicting_sessions}))"
    ))
    bind.execute(sa.text(
        "UPDATE generation_runs SET status = 'interrupted', "
        "error = COALESCE(error, 'Overlapping generation recovered during schema upgrade'), "
        "completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) "
        f"WHERE status = 'streaming' AND session_id IN ({conflicting_sessions})"
    ))
    existing = next((index for index in sa.inspect(bind).get_indexes("generation_runs")
                     if index["name"] == "uq_generation_runs_streaming_session"), None)
    if existing is None:
        op.create_index(
            "uq_generation_runs_streaming_session", "generation_runs", ["session_id"],
            unique=True, sqlite_where=sa.text("status = 'streaming'"),
            postgresql_where=sa.text("status = 'streaming'"),
        )
    elif not existing["unique"] or existing["column_names"] != ["session_id"]:
        raise RuntimeError("Existing generation index does not enforce the expected session constraint")


def downgrade() -> None:
    op.drop_index("uq_generation_runs_streaming_session", table_name="generation_runs")
