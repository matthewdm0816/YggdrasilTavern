from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0005_profile_token_limits"
down_revision = "0004_global_prompt_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("api_profiles")}
    with op.batch_alter_table("api_profiles") as batch:
        if "input_token_limit" not in columns:
            batch.add_column(
                sa.Column("input_token_limit", sa.Integer(), nullable=False, server_default="262144")
            )
        if "output_token_limit" not in columns:
            batch.add_column(
                sa.Column("output_token_limit", sa.Integer(), nullable=False, server_default="32768")
            )
        if "model_catalog" not in columns:
            batch.add_column(
                sa.Column("model_catalog", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
            )
        if "models_refreshed_at" not in columns:
            batch.add_column(sa.Column("models_refreshed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("api_profiles")}
    with op.batch_alter_table("api_profiles") as batch:
        for name in ("models_refreshed_at", "model_catalog", "output_token_limit", "input_token_limit"):
            if name in columns:
                batch.drop_column(name)
