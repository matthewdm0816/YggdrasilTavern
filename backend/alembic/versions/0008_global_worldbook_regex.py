"""Move worldbook selection and Regex rules from sessions to one global config.

Like the global Prompt migration, each value is taken from the most recently
updated session that has one; the session presets keep their old values.
"""

from __future__ import annotations

import json
from typing import Any

from alembic import op
import sqlalchemy as sa


revision = "0008_global_worldbook_regex"
down_revision = "0007_sillytavern_import"
branch_labels = None
depends_on = None


def _preset(raw: Any) -> dict:
    try:
        value = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _legacy_values(bind: sa.Connection) -> tuple[list, list]:
    tables = set(sa.inspect(bind).get_table_names())
    worldbook_ids: list | None = None
    regex_rules: list | None = None
    if "sessions" in tables:
        rows = bind.execute(sa.text("SELECT worldbook_id, preset FROM sessions ORDER BY updated_at DESC"))
        for legacy_worldbook_id, raw_preset in rows:
            preset = _preset(raw_preset)
            if worldbook_ids is None:
                configured = preset.get("worldbook_ids")
                ids = [legacy_worldbook_id, *(configured if isinstance(configured, list) else [])]
                ids = [value for value in ids if isinstance(value, str) and value.strip()]
                if ids:
                    worldbook_ids = list(dict.fromkeys(value.strip() for value in ids))
            if regex_rules is None and isinstance(preset.get("regex_rules"), list) and preset["regex_rules"]:
                regex_rules = preset["regex_rules"]
    if "default_session_config" in tables:
        # SillyTavern imports stored its global worldbooks and Regex here for new sessions.
        raw_defaults = bind.execute(sa.text("SELECT preset FROM default_session_config WHERE id = 'default'")).scalar()
        defaults = _preset(raw_defaults)
        if worldbook_ids is None and isinstance(defaults.get("worldbook_ids"), list):
            worldbook_ids = [value for value in defaults["worldbook_ids"] if isinstance(value, str) and value.strip()]
        if regex_rules is None and isinstance(defaults.get("regex_rules"), list):
            regex_rules = defaults["regex_rules"]
    existing = (
        set(bind.execute(sa.text("SELECT id FROM worldbooks")).scalars())
        if "worldbooks" in tables
        else set()
    )
    return [value for value in worldbook_ids or [] if value in existing], regex_rules or []


def upgrade() -> None:
    bind = op.get_bind()
    if "global_worldbook_regex_config" in set(sa.inspect(bind).get_table_names()):
        return
    table = op.create_table(
        "global_worldbook_regex_config",
        sa.Column("id", sa.String(length=32), primary_key=True),
        sa.Column("worldbook_ids", sa.JSON(), nullable=False),
        sa.Column("regex_rules", sa.JSON(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
    )
    worldbook_ids, regex_rules = _legacy_values(bind)
    bind.execute(table.insert().values(id="default", worldbook_ids=worldbook_ids, regex_rules=regex_rules, revision=1))


def downgrade() -> None:
    op.drop_table("global_worldbook_regex_config")
