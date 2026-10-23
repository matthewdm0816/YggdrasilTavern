from alembic import command
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from app import models
from app.database import create_database_engine
from app.database_schema import _alembic_config


def test_custom_request_migration_preserves_old_profile_and_adds_safe_defaults():
    engine = create_database_engine("sqlite:///:memory:")
    config = _alembic_config("sqlite:///:memory:")
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.upgrade(config, "0011_worldbook_recursion")
        assert "custom_headers" not in {column["name"] for column in inspect(connection).get_columns("api_profiles")}
        connection.execute(text(
            "INSERT INTO api_profiles (id, name, provider_type, base_url, model, api_key_env, api_key, default_params) "
            "VALUES ('old', 'Old profile', 'openai_chat_completions', 'https://provider.test', 'model', '', 'old-key', :params)"
        ), {"params": '{"temperature":0.7}'})
        command.upgrade(config, "0012_custom_request_settings")
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
    with Session(engine) as db:
        profile = db.get(models.APIProfile, "old")
        assert profile.name == "Old profile"
        assert profile.api_key == "old-key"
        assert profile.default_params == {"temperature": 0.7}
        assert profile.custom_headers == {}
        assert profile.excluded_body_params == []
        assert profile.anthropic_prompt_cache is False
    engine.dispose()
