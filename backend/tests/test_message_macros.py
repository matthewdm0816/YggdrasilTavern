import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base, get_db
from app.main import create_app
from app.services.macros import expand_macros
from app.services.prompt_builder import expand_macros as compatibility_expand
from app.services.token_counter import count_text_tokens
from app.services import tts

CASES = json.loads((Path(__file__).resolve().parents[2] / "shared/macro-cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_shared_macro_contract(case):
    character = SimpleNamespace(**case["character"]) if case["character"] else None
    args = (case["text"], character, case["user_name"], case.get("original", ""))
    assert expand_macros(*args) == case["expected"]
    assert compatibility_expand(*args) == case["expected"]


@pytest.fixture
def client():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.create_all(engine)
    app = create_app(init_on_startup=False)

    def override_db():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as value:
        yield value, factory
    engine.dispose()


def test_raw_greetings_scan_context_tts_counts_and_swipes(client, monkeypatch):
    api, factory = client
    raw = "<tts>Hello {{user}}, I am {{char}}.</tts>"
    char = api.post("/api/characters", json={
        "name": "Apeiria", "first_mes": raw, "alternate_greetings": ["Another {{char}}"],
    }).json()
    book = api.post("/api/worldbooks", json={"name": "Name lore", "entries": [
        {"keys": ["Apeiria"], "content": "The character name triggered this lore."},
    ]}).json()
    settings = api.put("/api/settings/worldbooks-regex", json={
        "expected_revision": 0, "worldbook_ids": [book["id"]], "regex_rules": [{
            "id": "out", "pattern": "Owner", "replacement": "OWNER", "flags": "g",
            "mode": "replace", "targets": ["outgoing_prompt"],
        }],
    })
    assert settings.status_code == 200, settings.text
    response = api.post("/api/sessions", json={"character_id": char["id"], "preset": {"user_name": "Owner"}})
    assert response.status_code == 200, response.text
    sid = response.json()["id"]
    tree = api.get(f"/api/sessions/{sid}/tree").json()
    assert "macro_context" not in tree
    roots = tree["messages"]
    assert [message["content"] for message in roots] == [raw, "Another {{char}}"]
    assert all(message["parent_id"] is None for message in roots)
    assert tree["session"]["active_root_child_id"] == roots[0]["id"]
    assert roots[0]["token_count"] == count_text_tokens("<tts>Hello Owner, I am Apeiria.</tts>")

    context = api.post(f"/api/sessions/{sid}/context/preview").json()
    assert context["activated_lore"][0]["content"] == "The character name triggered this lore."
    assert any("Hello OWNER, I am Apeiria." in item["content"] for item in context["messages"])
    preview = api.post(f"/api/messages/{roots[0]['id']}/tts/preview", json={"mode": "tags"})
    assert preview.status_code == 200, preview.text
    assert preview.json()["text"] == "Hello Owner, I am Apeiria."

    with factory() as db:
        db.add(models.TtsSettings(enabled=True, text_mode="tags", voice="test", api_key="fake"))
        db.commit()
    spoken = []

    async def fake_synthesize(settings, text):
        spoken.append(text)
        return b"ID3fake"

    monkeypatch.setattr(tts, "synthesize", fake_synthesize)
    assert api.post(f"/api/messages/{roots[0]['id']}/tts").status_code == 200
    assert api.post(f"/api/messages/{roots[0]['id']}/tts", json={"text": "Edited {{char}}"}).status_code == 200
    assert spoken == ["Hello Owner, I am Apeiria.", "Edited Apeiria"]
    copied = api.post(f"/api/messages/{roots[0]['id']}/swipes", json={"content": raw}).json()
    assert len(copied["messages"]) == 3
    assert sum(message["content"] == raw for message in copied["messages"]) == 2
    assert api.get(f"/api/sessions/{sid}/tree").json()["messages"][0]["content"] == raw
