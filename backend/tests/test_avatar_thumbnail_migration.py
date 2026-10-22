import base64
import io
from pathlib import Path
from unittest.mock import Mock

import pytest
from alembic import command
from alembic.config import Config
from PIL import Image
from sqlalchemy import MetaData, Table, create_engine, inspect, text

from app.services import avatar_thumbnail


@pytest.mark.parametrize("existing_column", [False, True])
def test_migration_backfills_once_and_preserves_originals(existing_column, monkeypatch):
    buffer = io.BytesIO()
    Image.new("RGB", (512, 512), (200, 120, 40)).save(buffer, format="PNG")
    original = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    remote = "https://example.test/avatar.png"
    broken = "data:image/png;base64,broken"
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.attributes["database_url"] = "sqlite:///:memory:"
    engine = create_engine("sqlite:///:memory:")
    try:
        with engine.begin() as connection:
            config.attributes["connection"] = connection
            command.upgrade(config, "0008_global_worldbook_regex")
            if existing_column:
                connection.execute(text("ALTER TABLE characters ADD COLUMN avatar_thumbnail_data_url TEXT"))
            table = Table("characters", MetaData(), autoload_with=connection)
            for character_id, avatar in (("image", original), ("remote", remote), ("broken", broken), ("empty", ""), ("none", None)):
                payload = dict.fromkeys((
                    "description", "personality", "scenario", "first_mes", "mes_example",
                    "creator_notes", "system_prompt", "post_history_instructions", "creator", "character_version",
                ), "")
                payload.update(
                    id=character_id, name=character_id, avatar_data_url=avatar, avatar_original_data_url=avatar,
                    alternate_greetings=[], tags=[], raw_json={}, extensions={}, avatar_transform={},
                )
                connection.execute(table.insert().values(**payload))
            before = connection.execute(text(
                "SELECT id, avatar_data_url, avatar_original_data_url, updated_at FROM characters ORDER BY id"
            )).all()
            encoder = Mock(wraps=avatar_thumbnail._encode_thumbnail)
            monkeypatch.setattr(avatar_thumbnail, "_encode_thumbnail", encoder)
            command.upgrade(config, "head")
            thumbnails = dict(connection.execute(text("SELECT id, avatar_thumbnail_data_url FROM characters")).all())
            assert thumbnails["image"].startswith("data:image/webp;base64,")
            assert len(thumbnails["image"]) < len(original) / 10
            assert thumbnails["remote"] == remote
            assert thumbnails["broken"] == broken
            assert not thumbnails["empty"]
            assert thumbnails["none"] is None
            assert connection.execute(text(
                "SELECT id, avatar_data_url, avatar_original_data_url, updated_at FROM characters ORDER BY id"
            )).all() == before
            assert encoder.call_count == 1
            command.upgrade(config, "head")
            assert encoder.call_count == 1
            command.downgrade(config, "0008_global_worldbook_regex")
            assert "avatar_thumbnail_data_url" not in {
                column["name"] for column in inspect(connection).get_columns("characters")
            }
            assert connection.execute(text(
                "SELECT id, avatar_data_url, avatar_original_data_url, updated_at FROM characters ORDER BY id"
            )).all() == before
    finally:
        engine.dispose()
