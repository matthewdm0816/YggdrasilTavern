import json

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import models
from app.config import Settings
from app.database import Base, Database, get_db
from app.main import create_app
from app.services.providers import endpoint_for
from app.services.prompt_builder import build_context
from app.services.tree import create_message
from app.services.st_directory_import import (
    apply_plan, backup_sqlite, build_plan, convert_prompt, convert_regex, plan_report, resource_id,
)
from app.services.st_directory_source import read_source, validate_source


def fixture_files():
    preset = {
        "temperature": 0.7, "top_p": 0.9, "openai_max_context": 10000, "openai_max_tokens": 1000,
        "prompts": [
            {"identifier": "main", "name": "Main", "role": "system", "content": "Imported main {{user}}"},
            {"identifier": "chatHistory", "name": "History", "marker": True},
            {"identifier": "worldInfoBefore", "name": "World Before", "marker": True},
            {"identifier": "jailbreak", "name": "Last", "role": "system", "content": "Final"},
        ],
        "prompt_order": [{"character_id": 100001, "order": [
            {"identifier": "main", "enabled": True}, {"identifier": "worldInfoBefore", "enabled": True},
            {"identifier": "chatHistory", "enabled": True}, {"identifier": "jailbreak", "enabled": False},
        ]}],
    }
    settings = {
        "username": "Ada", "main_api": "openai",
        "oai_settings": {**preset, "chat_completion_source": "custom", "custom_url": "https://live.test/provider/v1", "custom_model": "live-model"},
        "extension_settings": {"connectionManager": {"profiles": [
            {"id": "fixed", "name": "Fixed", "mode": "cc", "api": "custom", "api-url": "https://saved.test/root", "model": "model", "preset": "Preset", "secret-id": "old"},
            {"id": "incomplete", "name": "Model only", "model": "gemini", "exclude": ["api-url", "secret-id", "api"]},
        ]}},
        "world_info_settings": {"world_info": {"globalSelect": ["Lore"]}, "world_info_depth": 3},
    }
    secrets = {"api_key_custom": [
        {"id": "old", "label": "Saved key", "active": False, "value": "test-inactive-secret"},
        {"id": "live", "label": "Live key", "active": True, "value": "test-active-secret"},
    ]}
    raw = {
        "settings.json": settings, "secrets.json": secrets, "OpenAI Settings/Preset.json": preset,
        "worlds/Lore.json": {"entries": {"0": {"key": ["moon"], "content": "Lore", "constant": True, "position": 0}}},
        "characters/Alice.json": {"spec": "chara_card_v2", "data": {"name": "Alice", "first_mes": "Hi {{user}}", "extensions": {"unknown": 7}}},
        "context/Unknown.json": {"name": "Unknown", "custom_field": 42},
        "sysprompt/Simple.json": {"name": "Simple", "content": "System text", "post_history": "End text"},
    }
    return {name: json.dumps(value).encode() for name, value in raw.items()}


def make_plan(files=None):
    return build_plan(files or fixture_files(), {"omitted": {"chats": 2}}, "ssh:test:/ST/data/default-user")


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    engine.dispose()


def test_import_uses_explicit_saved_key_and_keeps_live_key_separate(db):
    plan = make_plan()
    result = apply_plan(db, plan, activate=True)
    saved = db.get(models.APIProfile, resource_id(plan.source, "profile", "fixed"))
    live = db.get(models.APIProfile, resource_id(plan.source, "profile", "settings.json:active"))
    assert saved.api_key == "test-inactive-secret"
    assert live.api_key == "test-active-secret"
    assert endpoint_for(saved) == "https://saved.test/root/chat/completions"
    assert saved.default_params["temperature"] == 0.7
    assert saved.input_token_limit == 9000 and saved.output_token_limit == 1000
    assert db.scalar(select(func.count()).select_from(models.SavedCredential)) == 2
    assert result["created"]["connection"] == 1
    assert "test-inactive-secret" not in json.dumps(result)
    assert "test-active-secret" not in json.dumps(result)
    defaults = db.get(models.DefaultSessionConfig, "default")
    assert defaults.api_profile_id == live.id
    assert defaults.preset["user_name"] == "Ada"
    assert len(defaults.preset["worldbook_ids"]) == 1


def test_repeat_import_preserves_local_changes_and_reports_remote_changes(db):
    plan = make_plan()
    apply_plan(db, plan)
    character_id = resource_id(plan.source, "character", "characters/Alice.json")
    db.get(models.Character, character_id).name = "Local edited Alice"
    db.commit()
    files = fixture_files()
    files["characters/Alice.json"] = b'{"name":"Remote edited Alice"}'
    result = apply_plan(db, make_plan(files))
    assert not result["created"]
    assert db.get(models.Character, character_id).name == "Local edited Alice"
    assert db.scalar(select(func.count()).select_from(models.Character)) == 1
    assert any("远端内容已改变" in warning for warning in result["warnings"])


def test_invalid_character_blocks_entire_import_without_writes(db):
    files = fixture_files()
    files["characters/Broken.json"] = b"not json"
    plan = make_plan(files)
    assert not plan_report(plan)["can_apply"]
    with pytest.raises(ValueError, match="数据库未写入"):
        apply_plan(db, plan)
    assert db.scalar(select(func.count()).select_from(models.APIProfile)) == 0


def test_database_failure_rolls_back_every_import_item(db, monkeypatch):
    plan = make_plan()
    original_flush = db.flush
    def fail():
        raise RuntimeError("simulated failure")
    monkeypatch.setattr(db, "flush", fail)
    with pytest.raises(RuntimeError, match="simulated failure"):
        apply_plan(db, plan)
    monkeypatch.setattr(db, "flush", original_flush)
    assert db.scalar(select(func.count()).select_from(models.ImportedResource)) == 0
    assert db.scalar(select(func.count()).select_from(models.APIProfile)) == 0


def test_raw_configuration_redacts_keys_and_proxy_passwords(db):
    files = fixture_files()
    settings = json.loads(files["settings.json"])
    settings["proxies"] = [{"name": "private", "password": "proxy-secret-test"}]
    settings["unknown"] = {"apiKey": "private-unknown-key", "note": "test-active-secret"}
    files["settings.json"] = json.dumps(settings).encode()
    apply_plan(db, make_plan(files))
    rows = list(db.scalars(select(models.ImportedResource)))
    public = json.dumps([{ "raw": row.raw_json, "converted": row.converted } for row in rows])
    for value in ("test-active-secret", "test-inactive-secret", "proxy-secret-test", "private-unknown-key"):
        assert value not in public


def test_prompt_order_disabled_flags_markers_and_depth_limits():
    raw = json.loads(fixture_files()["OpenAI Settings/Preset.json"])
    raw["prompts"][0]["injection_position"] = 1
    slots, warnings = convert_prompt(raw)
    assert [s["id"] for s in slots[:4]] == ["main", "world_before", "history", "post_history"]
    assert not slots[0]["enabled"] and not slots[3]["enabled"]
    assert slots[1]["content"] is None
    assert warnings


def test_role_specific_regex_is_preserved_without_broadening_scope():
    rules, warnings = convert_regex([{
        "scriptName": "User only", "findRegex": "/secret/g", "placement": [1],
        "markdownOnly": True, "replaceString": ""
    }])
    assert rules == [] and warnings


def test_unsupported_worldbook_positions_are_not_silently_moved(db):
    files = fixture_files()
    raw = json.loads(files["worlds/Lore.json"])
    raw["entries"]["0"]["position"] = 4
    files["worlds/Lore.json"] = json.dumps(raw).encode()
    apply_plan(db, make_plan(files))
    entry = db.scalar(select(models.WorldBookEntry))
    assert not entry.enabled
    assert entry.raw_json["position"] == 4


def test_worldbook_scan_depth_does_not_use_prompt_injection_depth(db):
    files = fixture_files()
    raw = json.loads(files["worlds/Lore.json"])
    raw["entries"]["0"].update(constant=False, depth=4, scanDepth=1)
    files["worlds/Lore.json"] = json.dumps(raw).encode()
    plan = make_plan(files)
    apply_plan(db, plan, activate=True)
    session = models.ChatSession(
        title="Scan depth", character_id=resource_id(plan.source, "character", "characters/Alice.json"),
        preset={"worldbook_ids": [resource_id(plan.source, "worldbook", "worlds/Lore.json")]},
    )
    db.add(session)
    db.commit()
    first = create_message(db, session, parent_id=None, role="user", content="moon")
    create_message(db, session, parent_id=first.id, role="assistant", content="sun")
    context = build_context(db, session)
    assert "Lore" not in context.system


def test_online_sqlite_backup_includes_committed_wal(tmp_path):
    database = Database(f"sqlite:///{(tmp_path / 'source.db').as_posix()}")
    database.initialize()
    with database.open_session() as db:
        db.add(models.Character(name="Backup me"))
        db.commit()
    backup = backup_sqlite(database.engine, tmp_path / "backups")
    restored = create_engine(f"sqlite:///{backup.as_posix()}")
    with restored.connect() as connection:
        assert connection.execute(text("SELECT name FROM characters")).scalar() == "Backup me"
    restored.dispose()
    database.dispose()


@pytest.mark.parametrize("host,user", [("-oProxyCommand=x", "default-user"), ("oc; touch /tmp/x", "default-user"), ("oc", "../other")])
def test_ssh_source_rejects_option_injection_and_user_traversal(host, user):
    with pytest.raises(ValueError):
        validate_source(host, "~/SillyTavern", user)


def test_local_reader_accepts_install_root_data_root_or_user_directory(tmp_path):
    root = tmp_path / "SillyTavern"
    user = root / "data/default-user"
    user.mkdir(parents=True)
    (user / "settings.json").write_text("{}")
    (user / "chats").mkdir()
    (user / "chats/old.jsonl").write_text("chat")
    for directory in (root, root / "data", user):
        files, manifest, source = read_source(str(directory))
        assert files == {"settings.json": b"{}"}
        assert manifest["omitted"]["chats"] == 1
        assert source == f"local:{user.resolve()}"


def test_import_api_preview_apply_no_secret_readback_and_new_session_defaults(db, monkeypatch):
    app = create_app(init_on_startup=False, settings=Settings(
        auth_enabled=False, auth_username=None, auth_password=None, auth_secret=None,
    ))
    def override():
        yield db
    app.dependency_overrides[get_db] = override
    monkeypatch.setattr("app.api.imports.read_source", lambda *a, **kw: (
        fixture_files(), {"omitted": {"chats": 2}}, "ssh:test:/ST/data/default-user",
    ))
    client = TestClient(app)
    preview = client.post("/api/imports/sillytavern/preview", json={"ssh_host": "test"})
    assert preview.status_code == 200
    assert "test-active-secret" not in preview.text
    assert db.scalar(select(func.count()).select_from(models.Character)) == 0
    apply = client.post("/api/imports/sillytavern/apply", json={"token": preview.json()["token"], "activate": True})
    assert apply.status_code == 200
    for endpoint in ("/api/api-profiles", "/api/saved-credentials", "/api/imports/resources?kind=settings", "/api/imports/resources?kind=credential", "/api/imports/resources?kind=prompt"):
        response = client.get(endpoint)
        assert response.status_code == 200
        assert "test-active-secret" not in response.text and "test-inactive-secret" not in response.text
    character = client.get("/api/characters").json()[0]
    session = client.post("/api/sessions", json={"character_id": character["id"]})
    assert session.status_code == 200
    assert session.json()["preset"]["user_name"] == "Ada"
    assert len(session.json()["preset"]["worldbook_ids"]) == 1
    assert session.json()["api_profile_id"]
    tree = client.get(f"/api/sessions/{session.json()['id']}/tree").json()
    assert tree["messages"][0]["content"] == "Hi Ada"
    assert client.post("/api/imports/sillytavern/apply", json={"token": preview.json()["token"]}).status_code == 410
    credentials = client.get("/api/saved-credentials").json()
    old_key = next(item for item in credentials if "Saved key" in item["name"])
    live_profile_id = session.json()["api_profile_id"]
    bound = client.post(f"/api/api-profiles/{live_profile_id}/credential", json={"credential_id": old_key["id"]})
    assert bound.status_code == 200 and bound.json()["has_api_key"]
    assert "test-inactive-secret" not in bound.text
    assert db.get(models.APIProfile, live_profile_id).api_key == "test-inactive-secret"
