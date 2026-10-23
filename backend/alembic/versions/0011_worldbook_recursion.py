"""Add recursive lore settings and conservatively repair ST scan-depth imports."""

import json
import logging

from alembic import op
import sqlalchemy as sa


revision = "0011_worldbook_recursion"
down_revision = "0010_tts_settings"
branch_labels = None
depends_on = None
log = logging.getLogger("alembic.runtime.migration")


def _raw(value, row_id):
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except (ValueError, TypeError):
        log.warning("Worldbook entry %s has invalid raw_json; source-based repairs skipped", row_id)
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _read(raw, *names):
    extension = raw.get("extensions")
    for source in (raw, extension if isinstance(extension, dict) else {}):
        for name in names:
            if name in source:
                return source[name]
    return None


def _integer(value):
    # Do not interpret arbitrary strings or booleans as imported depths.
    return value if type(value) is int and value >= 0 else None


def upgrade():
    bind = op.get_bind()
    book_columns = {column["name"] for column in sa.inspect(bind).get_columns("worldbooks")}
    if "max_recursion_steps" not in book_columns:
        op.add_column("worldbooks", sa.Column("max_recursion_steps", sa.Integer(), nullable=False, server_default="0"))
    entry_columns = {column["name"] for column in sa.inspect(bind).get_columns("worldbook_entries")}
    for name in ("exclude_recursion", "prevent_recursion"):
        if name not in entry_columns:
            op.add_column("worldbook_entries", sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()))
    if "delay_until_recursion" not in entry_columns:
        op.add_column("worldbook_entries", sa.Column("delay_until_recursion", sa.Integer(), nullable=False, server_default="0"))

    for row in bind.execute(sa.text("SELECT id, raw_json FROM worldbooks")).mappings():
        raw = _raw(row["raw_json"], row["id"])
        steps = _integer(_read(raw, "max_recursion_steps", "maxRecursionSteps"))
        if steps is not None and "max_recursion_steps" not in book_columns:
            bind.execute(sa.text("UPDATE worldbooks SET max_recursion_steps = :steps WHERE id = :id"), {"steps": steps, "id": row["id"]})

    for row in bind.execute(sa.text("SELECT id, depth, raw_json FROM worldbook_entries")).mappings():
        raw = _raw(row["raw_json"], row["id"])
        changes = {}
        for name, alias in (("exclude_recursion", "excludeRecursion"), ("prevent_recursion", "preventRecursion")):
            value = _read(raw, name, alias)
            if name not in entry_columns and type(value) in (bool, int) and value in (0, 1):
                changes[name] = bool(value)
        delay = _read(raw, "delay_until_recursion", "delayUntilRecursion")
        if isinstance(delay, bool):
            delay = int(delay)
        if "delay_until_recursion" not in entry_columns and _integer(delay) is not None:
            changes["delay_until_recursion"] = delay

        extension = raw.get("extensions") if isinstance(raw.get("extensions"), dict) else {}
        st_source = (
            ("key" in raw and "keys" not in raw)
            or type(raw.get("position")) is int
            or any(name in raw for name in ("scanDepth", "excludeRecursion", "preventRecursion", "delayUntilRecursion"))
            or any(name in extension for name in ("depth", "scan_depth"))
        )
        insertion_depth = _integer(_read(raw, "depth"))
        scan_depth = _read(raw, "scanDepth", "scan_depth")
        if (st_source and insertion_depth is not None and row["depth"] == insertion_depth
                and (scan_depth is None or _integer(scan_depth) is not None)):
            changes["depth"] = scan_depth
        if changes:
            assignments = ", ".join(f"{name} = :{name}" for name in changes)
            bind.execute(sa.text(f"UPDATE worldbook_entries SET {assignments} WHERE id = :id"), {**changes, "id": row["id"]})


def downgrade():
    # Corrected scan depths remain corrected; restoring insertion-depth mistakes is unsafe.
    with op.batch_alter_table("worldbook_entries") as batch:
        batch.drop_column("delay_until_recursion")
        batch.drop_column("prevent_recursion")
        batch.drop_column("exclude_recursion")
    with op.batch_alter_table("worldbooks") as batch:
        batch.drop_column("max_recursion_steps")
