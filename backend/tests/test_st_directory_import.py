import json

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app import models, schemas
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
    assert defaults.preset == {"user_name": "Ada"}
    shared = db.get(models.GlobalWorldbookRegexConfig, "default")
    assert shared.worldbook_ids == [resource_id(plan.source, "worldbook", "worlds/Lore.json")]


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
    assert db.get(models.GlobalWorldbookRegexConfig, "default").worldbook_ids == [
        resource_id(plan.source, "worldbook", "worlds/Lore.json")
    ]
    session = models.ChatSession(
        title="Scan depth", character_id=resource_id(plan.source, "character", "characters/Alice.json"),
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
    assert session.json()["preset"]["worldbook_ids"] == []
    assert len(client.get("/api/settings/worldbooks-regex").json()["worldbook_ids"]) == 1
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


def test_directory_worldbook_inherits_recursion_and_uses_shared_card_conversion():
    files = fixture_files()
    settings = json.loads(files["settings.json"])
    settings["world_info_settings"].update(world_info_recursive=True, world_info_max_recursion_steps=3)
    files["settings.json"] = json.dumps(settings).encode()
    entry = {"keys": ["moon"], "content": "synthetic lore", "position": "after_char",
             "extensions": {"scan_depth": 2, "depth": 9, "exclude_recursion": True,
                            "prevent_recursion": True, "delay_until_recursion": 5}}
    files["worlds/Lore.json"] = json.dumps({"entries": [entry]}).encode()
    files["characters/Alice.json"] = json.dumps({"name": "Alice", "character_book": {"entries": [{**entry, "extensions": {**entry["extensions"], "position": 4}}]}}).encode()
    plan = make_plan(files)
    assert not plan.errors
    book = next(item for item in plan.items if item.kind == "worldbook")
    assert book.payload["recursive_scanning"] and book.payload["max_recursion_steps"] == 3
    converted = book.payload["entries"][0]
    assert converted["depth"] == 2 and converted["delay_until_recursion"] == 5
    assert converted["exclude_recursion"] and converted["prevent_recursion"]
    assert not any("递归世界书扫描尚未支持" in warning for warning in plan_report(plan)["warnings"])
    character = next(item for item in plan.items if item.kind == "character")
    assert any("@D" in warning for warning in character.warnings)


@pytest.mark.parametrize("as_json", [True, False])
def test_custom_request_settings_are_applied_without_header_readback(db, as_json):
    files = fixture_files()
    settings = json.loads(files["settings.json"])
    changes = {
        "custom_include_body": json.dumps({"temperature": 0.2, "top_k": 23, "nested": {"enabled": True}}) if as_json else 'temperature: 0.2\ntop_k: 23\nnested: {"enabled": true}',
        "custom_include_headers": json.dumps({"X-Test-Token": "synthetic-header-secret"}) if as_json else "X-Test-Token: synthetic-header-secret",
        "custom_exclude_body": json.dumps(["frequency_penalty", "seed"]) if as_json else "frequency_penalty: true\nseed: true",
    }
    settings["oai_settings"].update(changes)
    files["settings.json"] = json.dumps(settings).encode()
    preset = json.loads(files["OpenAI Settings/Preset.json"])
    preset.update(changes)
    files["OpenAI Settings/Preset.json"] = json.dumps(preset).encode()
    plan = make_plan(files)
    assert not plan.errors
    assert not any("尚未转换" in warning and "custom_" in warning for warning in plan_report(plan)["warnings"])
    result = apply_plan(db, plan)
    profile = db.get(models.APIProfile, resource_id(plan.source, "profile", "settings.json:active"))
    assert profile.custom_headers == {"X-Test-Token": "synthetic-header-secret"}
    assert profile.excluded_body_params == ["frequency_penalty", "seed"]
    assert profile.default_params["temperature"] == 0.2 and profile.default_params["top_k"] == 23
    assert profile.default_params["nested"] == {"enabled": True}
    resources = [{"raw_json": row.raw_json, "converted": row.converted, "warnings": row.warnings} for row in db.scalars(select(models.ImportedResource))]
    assert "synthetic-header-secret" not in json.dumps([resources, result, plan_report(plan)])
    assert "synthetic-header-secret" not in schemas.APIProfileOut.model_validate(profile).model_dump_json()


def test_complex_custom_yaml_is_warned_and_never_partially_applied():
    files = fixture_files()
    settings = json.loads(files["settings.json"])
    settings["oai_settings"].update(custom_include_body="temperature: 0.2\nnested:\n  token: private",
                                  custom_include_headers="X-Test: |\n  synthetic-hidden-value",
                                  custom_exclude_body="- seed\n- stop")
    files["settings.json"] = json.dumps(settings).encode()
    plan = make_plan(files)
    profile = next(item for item in plan.items if item.kind == "profile" and item.key == "settings.json:active")
    assert profile.payload["custom_headers"] == {} and profile.payload["excluded_body_params"] == []
    assert profile.payload["default_params"]["temperature"] == 0.7
    assert sum("格式尚未支持" in warning for warning in profile.warnings) == 3
    assert "synthetic-hidden-value" not in json.dumps([item.raw for item in plan.items])
    assert "synthetic-hidden-value" not in json.dumps(plan_report(plan))


def test_custom_auth_header_can_supply_the_imported_profile_credential():
    files = fixture_files()
    files["secrets.json"] = b"{}"
    settings = json.loads(files["settings.json"])
    settings["oai_settings"]["custom_include_headers"] = '{"Authorization": "Bearer synthetic-import-only"}'
    files["settings.json"] = json.dumps(settings).encode()
    plan = make_plan(files)
    assert not plan.errors
    profile = next(item for item in plan.items if item.kind == "profile" and item.key == "settings.json:active")
    assert profile.payload["api_key"] is None
    assert profile.payload["custom_headers"] == {"Authorization": "Bearer synthetic-import-only"}
    assert "synthetic-import-only" not in json.dumps([item.raw for item in plan.items])
    assert "synthetic-import-only" not in json.dumps(plan_report(plan))


def test_invalid_header_values_are_skipped_with_a_value_free_warning():
    files = fixture_files()
    settings = json.loads(files["settings.json"])
    settings["oai_settings"]["custom_include_headers"] = json.dumps({"X-Test": "private-synthetic\r\nHeader: injected"})
    files["settings.json"] = json.dumps(settings).encode()
    plan = make_plan(files)
    assert not plan.errors
    profile = next(item for item in plan.items if item.kind == "profile" and item.key == "settings.json:active")
    assert profile.payload["custom_headers"] == {}
    assert any("custom_include_headers" in warning for warning in profile.warnings)
    assert "private-synthetic" not in json.dumps(plan_report(plan))


@pytest.mark.parametrize("custom_body", [
    '{"temperature": 0.2, "top_k": NaN}',
    '{"temperature": 0.2, "top_k": Infinity}',
    '{"temperature": 0.2, "top_k": -Infinity}',
    '{"temperature": 0.2, "top_k": 1e309}',
    '{"temperature": 0.2, "nested": {"values": [1, NaN]}}',
    '{"temperature": 0.2, "nested": {"values": [1, 1e309]}}',
    'temperature: 0.2\ntop_k: NaN',
    'temperature: 0.2\ntop_k: Infinity',
    'temperature: 0.2\ntop_k: 1e309',
    'temperature: 0.2\nnested: {"values": [1, -1e309]}',
    {"temperature": 0.2, "nested": {"values": [float("nan")]}},
    {"temperature": 0.2, "nested": {"values": [float("inf")]}},
])
def test_nonfinite_custom_body_is_warned_and_the_whole_option_is_skipped(custom_body):
    files = fixture_files()
    settings = json.loads(files["settings.json"])
    settings["oai_settings"]["custom_include_body"] = custom_body
    settings["oai_settings"]["custom_include_headers"] = '{"X-Test": "synthetic-header"}'
    files["settings.json"] = json.dumps(settings).encode()
    plan = make_plan(files)
    assert not plan.errors
    profile = next(item for item in plan.items if item.kind == "profile" and item.key == "settings.json:active")
    assert profile.payload["default_params"]["temperature"] == 0.7
    assert "top_k" not in profile.payload["default_params"] and "nested" not in profile.payload["default_params"]
    assert profile.payload["custom_headers"] == {"X-Test": "synthetic-header"}
    assert any("custom_include_body" in warning and "数字必须有限" in warning for warning in profile.warnings)


def test_finite_custom_body_numbers_and_nonfinite_looking_strings_are_preserved():
    files = fixture_files()
    settings = json.loads(files["settings.json"])
    settings["oai_settings"]["custom_include_body"] = '{"scale": 1e300, "nested": [0, -2.5, "NaN", "Infinity"]}'
    files["settings.json"] = json.dumps(settings).encode()
    plan = make_plan(files)
    profile = next(item for item in plan.items if item.kind == "profile" and item.key == "settings.json:active")
    assert profile.payload["default_params"]["scale"] == 1e300
    assert profile.payload["default_params"]["nested"] == [0, -2.5, "NaN", "Infinity"]
    assert not any("custom_include_body" in warning for warning in profile.warnings)


def test_direct_worldbook_and_character_import_expose_persistent_warnings_and_roundtrip(db):
    app = create_app(init_on_startup=False, settings=Settings(
        auth_enabled=False, auth_username=None, auth_password=None, auth_secret=None,
    ))
    def override():
        yield db
    app.dependency_overrides[get_db] = override
    client = TestClient(app)
    book = {"name": "Synthetic", "recursive_scanning": True, "max_recursion_steps": 3,
            "entries": [{"keys": ["moon"], "content": "synthetic", "position": "after_char",
                         "extensions": {"position": 4, "depth": 9, "scan_depth": 1,
                                        "exclude_recursion": True, "delay_until_recursion": 5}}]}
    imported = client.post("/api/worldbooks/import", files={"file": ("synthetic.json", json.dumps(book).encode(), "application/json")})
    assert imported.status_code == 200
    initial = imported.json()
    assert initial["entries"][0]["depth"] == 1 and not initial["entries"][0]["enabled"]
    assert any("@D" in warning for warning in initial["import_warnings"])
    db.expire_all()
    assert client.get("/api/worldbooks").json()[0]["import_warnings"] == initial["import_warnings"]
    edited_entry = {**initial["entries"][0], "position": "before_char", "enabled": True, "depth": 2,
                    "exclude_recursion": False, "prevent_recursion": True, "delay_until_recursion": 7}
    updated = client.patch(f"/api/worldbooks/{initial['id']}", json={"entries": [edited_entry], "max_recursion_steps": 4})
    assert updated.status_code == 200
    exported = client.get(f"/api/worldbooks/{initial['id']}/export")
    assert exported.status_code == 200
    reimported = client.post("/api/worldbooks/import", files={"file": ("roundtrip.json", exported.content, "application/json")})
    assert reimported.status_code == 200
    final = reimported.json()
    assert final["max_recursion_steps"] == 4 and final["recursive_scanning"]
    entry = final["entries"][0]
    assert entry["enabled"] and entry["position"] == "before_char" and entry["depth"] == 2
    assert not entry["exclude_recursion"] and entry["prevent_recursion"] and entry["delay_until_recursion"] == 7
    assert final["import_warnings"] == []
    card = {"spec": "chara_card_v2", "data": {"name": "Synthetic", "character_book": book}}
    character = client.post("/api/characters/import", files={"file": ("character.json", json.dumps(card).encode(), "application/json")})
    assert character.status_code == 200 and character.json()["import_warnings"]
    db.expire_all()
    assert client.get(f"/api/characters/{character.json()['id']}").json()["import_warnings"] == character.json()["import_warnings"]
