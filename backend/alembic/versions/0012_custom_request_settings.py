"""Add per-profile custom requests and optional Anthropic prompt caching."""

from alembic import op
import sqlalchemy as sa


revision = "0012_custom_request_settings"
down_revision = "0011_worldbook_recursion"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("api_profiles")}
    for column in (
        sa.Column("custom_headers", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("excluded_body_params", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("anthropic_prompt_cache", sa.Boolean(), nullable=False, server_default=sa.false()),
    ):
        if column.name not in existing:
            op.add_column("api_profiles", column)


def downgrade() -> None:
    for name in ("anthropic_prompt_cache", "excluded_body_params", "custom_headers"):
        op.drop_column("api_profiles", name)
