from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0004_global_prompt_config"
down_revision = "0003_generation_runs_integrity"
branch_labels = None
depends_on = None


DEFAULT_PROMPT_SLOTS: list[dict[str, Any]] = [
    {"id": "main", "kind": "main", "name": "Main Prompt", "enabled": True, "role": "system", "content": None},
    {"id": "world_before", "kind": "world_before", "name": "World Info Before", "enabled": True, "role": "system", "content": None},
    {"id": "char_description", "kind": "char_description", "name": "Character Description", "enabled": True, "role": "system", "content": None},
    {"id": "char_personality", "kind": "char_personality", "name": "Character Personality", "enabled": True, "role": "system", "content": None},
    {"id": "scenario", "kind": "scenario", "name": "Scenario", "enabled": True, "role": "system", "content": None},
    {"id": "examples", "kind": "examples", "name": "Example Dialogue", "enabled": True, "role": "system", "content": None},
    {"id": "pre_history", "kind": "pre_history", "name": "Pre-History Instruction", "enabled": True, "role": "system", "content": None},
    {"id": "history", "kind": "history", "name": "Chat History", "enabled": True, "role": "system", "content": None},
    {"id": "world_after", "kind": "world_after", "name": "World Info After", "enabled": True, "role": "system", "content": None},
    {"id": "post_history", "kind": "post_history", "name": "Post-History Instruction", "enabled": True, "role": "system", "content": None},
]


def _latest_legacy_slots(bind: sa.Connection) -> list[dict[str, Any]]:
    if "sessions" not in sa.inspect(bind).get_table_names():
        return DEFAULT_PROMPT_SLOTS
    rows = bind.execute(sa.text("SELECT preset FROM sessions ORDER BY updated_at DESC")).scalars()
    for raw_preset in rows:
        try:
            preset = json.loads(raw_preset) if isinstance(raw_preset, str) else raw_preset
        except (TypeError, ValueError):
            continue
        slots = preset.get("prompt_slots") if isinstance(preset, dict) else None
        if isinstance(slots, list) and slots:
            return slots
    return DEFAULT_PROMPT_SLOTS


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "global_prompt_config" not in tables:
        prompt_table = op.create_table(
            "global_prompt_config",
            sa.Column("id", sa.String(length=32), primary_key=True),
            sa.Column("prompt_slots", sa.JSON(), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        )
        bind.execute(
            prompt_table.insert().values(
                id="default",
                prompt_slots=_latest_legacy_slots(bind),
                revision=1,
            )
        )

    api_profile_columns = {
        column["name"] for column in sa.inspect(bind).get_columns("api_profiles")
    }
    if "api_key" not in api_profile_columns:
        with op.batch_alter_table("api_profiles") as batch:
            batch.add_column(sa.Column("api_key", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "api_profiles" in tables:
        columns = {column["name"] for column in sa.inspect(bind).get_columns("api_profiles")}
        if "api_key" in columns:
            with op.batch_alter_table("api_profiles") as batch:
                batch.drop_column("api_key")
    if "global_prompt_config" in tables:
        op.drop_table("global_prompt_config")
