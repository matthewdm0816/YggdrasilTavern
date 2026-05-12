from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_message_tokens_thinking"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("thinking_content", sa.Text(), nullable=False, server_default=""))
    op.add_column("messages", sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("messages", sa.Column("thinking_token_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("messages", sa.Column("cached_tokens", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("messages", "cached_tokens")
    op.drop_column("messages", "thinking_token_count")
    op.drop_column("messages", "token_count")
    op.drop_column("messages", "thinking_content")
