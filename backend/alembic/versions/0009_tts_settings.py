"""Add optional per-user speech settings without changing existing resources."""

from alembic import op
import sqlalchemy as sa


revision = "0009_tts_settings"
down_revision = "0008_global_worldbook_regex"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "tts_settings" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "tts_settings",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("provider", sa.String(40), nullable=False, server_default="minimax"),
        sa.Column("endpoint", sa.String(1000), nullable=False, server_default="https://api.minimax.cn/v1/t2a_v2"),
        sa.Column("model", sa.String(200), nullable=False, server_default="speech-2.8-hd"),
        sa.Column("voice", sa.String(200), nullable=False, server_default=""),
        sa.Column("api_key", sa.Text(), nullable=True),
        sa.Column("speed", sa.Float(), nullable=False, server_default="1"),
        sa.Column("volume", sa.Float(), nullable=False, server_default="1"),
        sa.Column("pitch", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("emotion", sa.String(80), nullable=False, server_default=""),
        sa.Column("language_boost", sa.String(80), nullable=False, server_default="auto"),
        sa.Column("text_mode", sa.String(20), nullable=False, server_default="dialogue"),
        sa.Column("trigger_mode", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("instruct_model", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )


def downgrade() -> None:
    op.drop_table("tts_settings")
