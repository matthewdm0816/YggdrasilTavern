from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import models
from app.accounts import users, sessions, verify_password
from app.auth import AUTH_COOKIE_NAME
from app.config import Settings
from app.main import create_app
from app.services import providers


PASSWORD = "independent-test-password"


def login(client, username, password=PASSWORD):
    result = client.post("/api/auth/login", json={"username": username, "password": password})
    assert result.status_code == 200, result.text
    assert result.json()["authenticated"]
    return result.json()["user"]


def create(client, path, payload):
    response = client.post(path, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def environment(tmp_path):
    settings = Settings(_env_file=None, database_url=f"sqlite:///{(tmp_path / 'legacy.db').as_posix()}",
                        auth_enabled=False, auth_username=None, auth_password=None, auth_secret=None)
    app = create_app(settings=settings)
    with TestClient(app) as owner:
        legacy = create(owner, "/api/characters", {"name": "Legacy owner character", "first_mes": "Hello owner"})
        status = create(owner, "/api/auth/setup", {"username": "owner", "password": PASSWORD, "display_name": "Owner"})
        assert status["user"]["is_owner"]
        alice = create(owner, "/api/auth/users", {"username": "alice", "password": PASSWORD, "display_name": "Alice"})
        bob = create(owner, "/api/auth/users", {"username": "bob", "password": PASSWORD, "display_name": "Bob"})
        with TestClient(app, raise_server_exceptions=True) as first, TestClient(app, raise_server_exceptions=True) as second:
            login(first, "alice")
            login(second, "bob")
            yield app, owner, first, second, legacy, alice, bob


def profile(name):
    return {"name": name, "provider_type": "openai_responses", "base_url": "https://example.test",
            "model": f"model-{name}", "api_key": f"private-key-{name}", "default_params": {"temperature": 0.25}}


def test_existing_data_stays_with_owner_and_all_resources_are_private(environment):
    app, owner, alice, bob, legacy, alice_user, _ = environment
    assert [item["id"] for item in owner.get("/api/characters").json()] == [legacy["id"]]
    assert alice.get("/api/characters").json() == []
    assert bob.get("/api/characters").json() == []
    character = create(alice, "/api/characters", {"name": "Alice private", "first_mes": "Hi Alice"})
    api_profile = create(alice, "/api/api-profiles", profile("alice"))
    worldbook = create(alice, "/api/worldbooks", {"name": "Alice world", "entries": [{"keys": ["cat"], "content": "Alice secret lore"}]})
    folder = create(alice, "/api/session-folders", {"name": "Alice folder"})
    session = create(alice, "/api/sessions", {"title": "Alice chat", "character_id": character["id"],
                     "api_profile_id": api_profile["id"], "worldbook_id": worldbook["id"], "folder_id": folder["id"]})
    tree = alice.get(f"/api/sessions/{session['id']}/tree").json()
    message_id = tree["messages"][0]["id"]
    for other in (owner, bob):
        for path in ("/api/api-profiles", "/api/worldbooks", "/api/session-folders", "/api/sessions", "/api/saved-credentials", "/api/imports/resources"):
            assert other.get(path).json() == [], path
        for path in (f"/api/characters/{character['id']}", f"/api/characters/{character['id']}/export",
                     f"/api/worldbooks/{worldbook['id']}/export", f"/api/sessions/{session['id']}/tree",
                     f"/api/sessions/{session['id']}/generation-runs"):
            assert other.get(path).status_code == 404, path
        for path, payload in ((f"/api/characters/{character['id']}", {"name": "Hijacked"}),
                              (f"/api/api-profiles/{api_profile['id']}", {"model": "Hijacked"}),
                              (f"/api/worldbooks/{worldbook['id']}", {"name": "Hijacked"}),
                              (f"/api/session-folders/{folder['id']}", {"name": "Hijacked"}),
                              (f"/api/sessions/{session['id']}", {"title": "Hijacked"}),
                              (f"/api/messages/{message_id}", {"content": "Hijacked"})):
            assert other.patch(path, json=payload).status_code == 404, path
            assert other.delete(path).status_code in (404, 405), path
        assert other.post(f"/api/sessions/{session['id']}/generate/stream", json={}).status_code == 404
    assert alice.get(f"/api/characters/{character['id']}").json()["name"] == "Alice private"
    assert alice.get("/api/api-profiles").json()[0]["model"] == "model-alice"
    assert "private-key-alice" not in alice.get("/api/api-profiles").text
    assert app.state.accounts.workspace(alice_user).database_url != app.state.database.database_url


def test_foreign_references_cannot_attach_other_users_resources(environment):
    _app, owner, alice, bob, legacy, *_ = environment
    alice_char = create(alice, "/api/characters", {"name": "Alice"})
    api_profile = create(alice, "/api/api-profiles", profile("alice"))
    worldbook = create(alice, "/api/worldbooks", {"name": "Alice world", "entries": []})
    bob_char = create(bob, "/api/characters", {"name": "Bob"})
    for field, value in (("character_id", legacy["id"]), ("character_id", alice_char["id"]),
                         ("api_profile_id", api_profile["id"]), ("worldbook_id", worldbook["id"])):
        response = bob.post("/api/sessions", json={"character_id": bob_char["id"], field: value})
        assert response.status_code in (400, 404), response.text
    assert bob.get("/api/sessions").json() == []


def test_prompt_defaults_credentials_and_import_records_do_not_mix(environment):
    app, owner, alice, bob, *_ = environment
    api_profile = create(alice, "/api/api-profiles", profile("alice"))
    data = alice.get("/api/settings/prompt").json()
    bob_prompt = bob.get("/api/settings/prompt").json()
    # Preserve the required built-ins while changing an existing text block.
    data["prompt_slots"][0]["enabled"] = False
    saved = alice.put("/api/settings/prompt", json={"prompt_slots": data["prompt_slots"], "expected_revision": data["revision"]})
    assert saved.status_code == 200, saved.text
    assert bob.get("/api/settings/prompt").json() == bob_prompt
    assert alice.get("/api/settings/prompt").json()["revision"] == data["revision"] + 1
    alice_user = alice.get("/api/auth/status").json()["user"]
    with app.state.accounts.workspace(alice_user).open_session() as db:
        db.add(models.SavedCredential(id="alice-key", name="Alice key", secret_type="api_key_openai", api_key="Alice-only-secret"))
        db.add(models.DefaultSessionConfig(preset={"user_name": "Alice persona"}, api_profile_id=api_profile["id"]))
        db.add(models.ImportedResource(id="alice-import", source="test", kind="prompt", source_key="one", name="Alice imported prompt", content_hash="a" * 64))
        db.commit()
    assert alice.get("/api/settings/session-defaults").json()["preset"]["user_name"] == "Alice persona"
    assert bob.get("/api/settings/session-defaults").json()["preset"] == {}
    assert bob.get("/api/imports/resources").json() == []
    assert bob.get("/api/saved-credentials").json() == []
    bob_profile = create(bob, "/api/api-profiles", profile("bob"))
    assert bob.post(f"/api/api-profiles/{bob_profile['id']}/credential", json={"credential_id": "alice-key"}).status_code == 404


def test_permissions_csrf_and_stale_browser_identity(environment):
    _app, owner, alice, bob, legacy, alice_user, _ = environment
    for path in ("/api/auth/users",):
        assert alice.get(path).status_code == 403
    assert alice.post("/api/auth/users", json={"username": "eve", "password": PASSWORD}).status_code == 403
    assert alice.patch(f"/api/auth/users/{alice_user['id']}", json={"active": False}).status_code == 403
    assert alice.post("/api/imports/sillytavern/preview", json={"directory": "/private", "ssh_host": "private-server", "user": "default-user"}).status_code == 403
    assert alice.post("/api/imports/sillytavern/apply", json={"token": "other-plan", "activate": False}).status_code == 403
    env_profile = {**profile("environment"), "api_key_env": "SERVER_PRIVATE_KEY", "api_key": None}
    assert alice.post("/api/api-profiles", json=env_profile).status_code == 403
    own_profile = create(alice, "/api/api-profiles", profile("alice"))
    assert alice.patch(f"/api/api-profiles/{own_profile['id']}", json={"api_key_env": "SERVER_PRIVATE_KEY"}).status_code == 403
    result = bob.post("/api/characters", json={"name": "Wrong account"}, headers={"X-Yggdrasil-User": alice_user["id"]})
    assert result.status_code == 409
    assert result.headers["X-Yggdrasil-Account-Changed"] == "1"
    assert bob.get("/api/characters").json() == []
    assert bob.post("/api/auth/logout", headers={"X-Yggdrasil-User": alice_user["id"]}).status_code == 409
    assert bob.get("/api/auth/status").json()["authenticated"]
    result = owner.post("/api/characters", json={"name": "CSRF"}, headers={"Origin": "https://attacker.test"})
    assert result.status_code == 403
    assert alice.patch("/api/auth/profile", json={"is_admin": True, "display_name": "Alice"}).status_code == 422


def test_logout_password_change_disable_reset_and_session_replay(environment):
    app, owner, alice, bob, _legacy, alice_user, bob_user = environment
    old_token = alice.cookies.get(AUTH_COOKIE_NAME)
    assert alice.post("/api/auth/logout").status_code == 200
    alice.cookies.set(AUTH_COOKIE_NAME, old_token)
    assert alice.get("/api/characters").status_code == 401
    alice.cookies.clear()
    login(alice, "alice")
    with TestClient(app) as second_login:
        login(second_login, "alice")
        assert alice.post("/api/auth/password", json={"current_password": "wrong", "password": "a-new-long-password"}).status_code == 400
        assert alice.post("/api/auth/password", json={"current_password": PASSWORD, "password": "a-new-long-password"}).status_code == 200
        assert alice.get("/api/characters").status_code == 200
        assert second_login.get("/api/characters").status_code == 401
    assert owner.patch(f"/api/auth/users/{bob_user['id']}", json={"active": False}).status_code == 200
    assert bob.get("/api/characters").status_code == 401
    assert bob.post("/api/auth/login", json={"username": "bob", "password": PASSWORD}).status_code == 401
    owner.patch(f"/api/auth/users/{bob_user['id']}", json={"active": True, "password": "reset-long-password"})
    login(bob, "BOB", "reset-long-password")
    owner_id = owner.get("/api/auth/status").json()["user"]["id"]
    assert owner.patch(f"/api/auth/users/{owner_id}", json={"active": False}).status_code == 400
    result = alice.patch("/api/auth/profile", json={"display_name": "Alice updated"})
    assert result.json()["display_name"] == "Alice updated"
    assert bob.get("/api/auth/status").json()["user"]["display_name"] == "Bob"
    with app.state.accounts._engine.connect() as connection:
        rows = list(connection.execute(select(users)).mappings())
        assert all(row["password_hash"].startswith("scrypt:") for row in rows)
        assert PASSWORD not in str(rows)
        assert verify_password("a-new-long-password", next(row for row in rows if row["id"] == alice_user["id"])["password_hash"])
        tokens = list(connection.execute(select(sessions.c.token_hash)).scalars())
        assert all(len(token) == 64 for token in tokens)
        assert bob.cookies.get(AUTH_COOKIE_NAME) not in tokens


def test_restart_keeps_accounts_owner_data_and_independent_profiles(tmp_path):
    settings = Settings(_env_file=None, database_url=f"sqlite:///{(tmp_path / 'restart.db').as_posix()}", auth_enabled=False)
    app = create_app(settings=settings)
    with TestClient(app) as client:
        original = create(client, "/api/characters", {"name": "Original owner data"})
        create(client, "/api/auth/setup", {"username": "owner", "password": PASSWORD})
        create(client, "/api/auth/users", {"username": "alice", "password": PASSWORD})
        login(client, "alice")
        private = create(client, "/api/characters", {"name": "Persistent Alice"})
        cookie = client.cookies.get(AUTH_COOKIE_NAME)
    with TestClient(create_app(settings=settings)) as client:
        assert client.get("/api/characters").status_code == 401
        client.cookies.set(AUTH_COOKIE_NAME, cookie)
        assert [item["id"] for item in client.get("/api/characters").json()] == [private["id"]]
        login(client, "owner")
        assert [item["id"] for item in client.get("/api/characters").json()] == [original["id"]]
        assert client.post("/api/auth/setup", json={"username": "takeover", "password": PASSWORD}).status_code == 409


def test_concurrent_generations_use_each_users_own_model_key_and_prompt(environment, monkeypatch):
    _app, _owner, alice, bob, *_ = environment
    seen = []
    async def fake_completion(api_profile, context):
        seen.append((api_profile.model, api_profile.api_key, context.messages[-1].content))
        yield f"Reply from {api_profile.model}"
    monkeypatch.setattr(providers, "stream_completion", fake_completion)
    chats = []
    for client, name in ((alice, "alice"), (bob, "bob")):
        character = create(client, "/api/characters", {"name": name})
        api_profile = create(client, "/api/api-profiles", profile(name))
        chat = create(client, "/api/sessions", {"character_id": character["id"], "api_profile_id": api_profile["id"]})
        create(client, f"/api/sessions/{chat['id']}/messages", {"role": "user", "content": f"Hello {name}"})
        chats.append((client, chat["id"]))
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda pair: pair[0].post(f"/api/sessions/{pair[1]}/generate/stream", json={}), chats))
    assert all(result.status_code == 200 and "message_completed" in result.text for result in results)
    assert sorted(seen) == [("model-alice", "private-key-alice", "Hello alice"), ("model-bob", "private-key-bob", "Hello bob")]
    for client, chat_id in chats:
        runs = client.get(f"/api/sessions/{chat_id}/generation-runs").json()
        assert len(runs) == 1
        other = bob if client is alice else alice
        assert other.get(f"/api/generation-runs/{runs[0]['id']}").status_code == 404
