"""Allow several in-progress generations in one chat session."""

from alembic import op
import sqlalchemy as sa


revision = "0013_parallel_generations"
down_revision = "0012_custom_request_settings"
branch_labels = None
depends_on = None

INDEX_NAME = "uq_generation_runs_streaming_session"


def upgrade() -> None:
    existing = {index["name"] for index in sa.inspect(op.get_bind()).get_indexes("generation_runs")}
    if INDEX_NAME in existing:
        op.drop_index(INDEX_NAME, table_name="generation_runs")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name not in {"sqlite", "postgresql"}:
        raise RuntimeError("The single-generation constraint requires SQLite or PostgreSQL")
    # The restored index allows one streaming run per session. Interrupt overlapping runs first; keep their messages.
    conflicting_sessions = (
        "SELECT session_id FROM generation_runs WHERE status = 'streaming' "
        "GROUP BY session_id HAVING COUNT(*) > 1"
    )
    bind.execute(sa.text(
        "UPDATE messages SET status = 'interrupted', "
        "error = COALESCE(error, 'Overlapping generation recovered during schema downgrade') "
        "WHERE id IN (SELECT output_message_id FROM generation_runs "
        f"WHERE status = 'streaming' AND session_id IN ({conflicting_sessions}))"
    ))
    bind.execute(sa.text(
        "UPDATE generation_runs SET status = 'interrupted', "
        "error = COALESCE(error, 'Overlapping generation recovered during schema downgrade'), "
        "completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP) "
        f"WHERE status = 'streaming' AND session_id IN ({conflicting_sessions})"
    ))
    op.create_index(
        INDEX_NAME, "generation_runs", ["session_id"],
        unique=True, sqlite_where=sa.text("status = 'streaming'"),
        postgresql_where=sa.text("status = 'streaming'"),
    )
