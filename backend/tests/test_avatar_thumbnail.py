import base64
import io
import json
import re
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from PIL import Image, PngImagePlugin
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models, schemas
from app.database import Base, get_db
from app.main import create_app
from app.services import avatar_thumbnail, chub_import
from app.services.avatar_thumbnail import thumbnail_data_url
from app.services.st_directory_import import apply_plan, build_plan, resource_id


def _png_data_url(size: int = 512, color: str = "#c87828") -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), color).save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _character_png() -> bytes:
    card = {"spec": "chara_card_v2", "data": {"name": "PNG Avatar", "first_mes": "Hello"}}
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("chara", base64.b64encode(json.dumps(card).encode("utf-8")).decode("ascii"))
    buffer = io.BytesIO()
    Image.new("RGB", (256, 256), "#c87828").save(buffer, format="PNG", pnginfo=metadata)
    return buffer.getvalue()


@pytest.fixture
def avatar_api():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    testing_session = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.create_all(engine)

    def override_db():
        with testing_session() as db:
            yield db

    app = create_app(init_on_startup=False)
    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            yield client, testing_session, engine
    finally:
        engine.dispose()


def _stored_thumbnail(testing_session, character_id: str) -> str | None:
    with testing_session() as db:
        character = db.get(models.Character, character_id)
        assert character is not None
        return character.avatar_thumbnail_data_url


def test_thumbnail_is_a_small_webp_data_url():
    original = _png_data_url()
    thumbnail = thumbnail_data_url(original)
    assert thumbnail is not None
    assert thumbnail.startswith("data:image/webp;base64,")
    assert len(thumbnail) < len(original) / 10
    with Image.open(io.BytesIO(base64.b64decode(thumbnail.split(",", 1)[1]))) as image:
        assert image.size == (128, 128)


def test_thumbnail_generation_has_no_process_cache(monkeypatch):
    encode = Mock(wraps=avatar_thumbnail._encode_thumbnail)
    monkeypatch.setattr(avatar_thumbnail, "_encode_thumbnail", encode)
    original = _png_data_url(256)
    first = thumbnail_data_url(original)
    second = thumbnail_data_url(original)
    assert second == first
    assert encode.call_count == 2
    assert [call.args[1] for call in encode.call_args_list] == [128, 128]


def test_thumbnail_respects_requested_size_and_preserves_aspect_ratio():
    buffer = io.BytesIO()
    Image.new("RGBA", (256, 128), (200, 120, 40, 100)).save(buffer, format="PNG")
    original = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    thumbnail = thumbnail_data_url(original, size=64)
    with Image.open(io.BytesIO(base64.b64decode(thumbnail.split(",", 1)[1]))) as image:
        assert image.size == (64, 32)
        assert image.mode == "RGBA"


@pytest.mark.parametrize(
    "original,expected",
    [
        ("https://example.test/avatar.png", "https://example.test/avatar.png"),
        ("data:image/png;base64,broken", "data:image/png;base64,broken"),
        ("data:image/png;base64," + base64.b64encode(b"not an image").decode("ascii"),
         "data:image/png;base64," + base64.b64encode(b"not an image").decode("ascii")),
        (None, None),
        ("", None),
    ],
)
def test_thumbnail_keeps_remote_urls_and_broken_images(original, expected):
    assert thumbnail_data_url(original) == expected


def test_character_create_persists_thumbnail_for_an_independent_session(avatar_api):
    client, testing_session, _ = avatar_api
    original = _png_data_url()
    expected = thumbnail_data_url(original)
    response = client.post(
        "/api/characters",
        json={"name": "Avatar", "avatar_data_url": original, "avatar_original_data_url": original},
    )
    assert response.status_code == 200, response.text
    created = response.json()
    assert created["avatar_data_url"] == original
    assert _stored_thumbnail(testing_session, created["id"]) == expected

    response = client.get("/api/characters")
    assert response.status_code == 200, response.text
    summary = next(item for item in response.json() if item["id"] == created["id"])
    assert summary["avatar_data_url"] == expected
    assert "avatar_thumbnail_data_url" not in summary

    response = client.get(f"/api/characters/{created['id']}")
    assert response.status_code == 200, response.text
    detail = response.json()
    assert detail["avatar_data_url"] == original
    assert detail["avatar_original_data_url"] == original


@pytest.mark.parametrize("original", [None, "https://example.test/avatar.png", "data:image/png;base64,broken"])
def test_character_insert_persists_empty_remote_and_broken_avatars(avatar_api, original):
    client, testing_session, _ = avatar_api
    with testing_session() as db:
        character = models.Character(name="Fallback avatar", avatar_data_url=original)
        db.add(character)
        db.commit()
        character_id = character.id

    assert _stored_thumbnail(testing_session, character_id) == original
    response = client.get("/api/characters")
    assert response.status_code == 200, response.text
    assert response.json()[0]["avatar_data_url"] == original


def test_repeated_lists_of_513_characters_never_generate_thumbnails(avatar_api, monkeypatch):
    client, testing_session, _ = avatar_api
    encode = Mock(wraps=avatar_thumbnail._encode_thumbnail)
    monkeypatch.setattr(avatar_thumbnail, "_encode_thumbnail", encode)
    original = _png_data_url(16)
    with testing_session() as db:
        db.add_all(models.Character(name=f"Avatar {index}", avatar_data_url=original) for index in range(513))
        db.commit()
    assert encode.call_count == 513

    with testing_session() as db:
        stored = dict(db.execute(select(models.Character.id, models.Character.avatar_thumbnail_data_url)).all())
    assert len(stored) == 513
    assert all(value and value.startswith("data:image/webp;base64,") for value in stored.values())
    generate = Mock(side_effect=AssertionError("List reads must not generate thumbnails"))
    monkeypatch.setattr(avatar_thumbnail, "thumbnail_data_url", generate)

    for _ in range(2):
        response = client.get("/api/characters")
        assert response.status_code == 200, response.text
        assert len(response.json()) == 513
        assert {item["id"]: item["avatar_data_url"] for item in response.json()} == stored
    assert encode.call_count == 513
    generate.assert_not_called()


def test_character_list_selects_persisted_thumbnail_without_original_or_details(avatar_api):
    client, _, engine = avatar_api
    response = client.post(
        "/api/characters",
        json={
            "name": "SQL Avatar",
            "avatar_data_url": _png_data_url(),
            "description": "Large description" * 100,
            "raw_json": {"large": "x" * 1000},
            "extensions": {"large": "x" * 1000},
            "character_book": {"large": "x" * 1000},
        },
    )
    assert response.status_code == 200, response.text
    statements = []

    def record_select(_connection, _cursor, statement, _parameters, _context, _executemany):
        normalized = " ".join(statement.lower().replace('"', "").split())
        if normalized.startswith("select") and re.search(r"\bcharacters\b", normalized):
            statements.append(normalized)

    event.listen(engine, "before_cursor_execute", record_select)
    try:
        response = client.get("/api/characters")
        assert response.status_code == 200, response.text
    finally:
        event.remove(engine, "before_cursor_execute", record_select)

    assert len(statements) == 1, statements
    statement = statements[0]
    assert "characters.avatar_thumbnail_data_url as avatar_data_url" in statement
    for field in (
        "avatar_data_url", "avatar_original_data_url", "description", "personality", "scenario",
        "first_mes", "mes_example", "creator_notes", "system_prompt", "post_history_instructions",
        "alternate_greetings", "raw_json", "extensions", "character_book",
    ):
        assert re.search(rf"\bcharacters\.{field}\b", statement) is None, statement
        assert field not in response.json()[0] or field == "avatar_data_url"


def test_character_patch_reencodes_only_when_avatar_changes(avatar_api, monkeypatch):
    client, testing_session, _ = avatar_api
    encode = Mock(wraps=avatar_thumbnail._encode_thumbnail)
    monkeypatch.setattr(avatar_thumbnail, "_encode_thumbnail", encode)
    original = _png_data_url(256)
    replacement = _png_data_url(256, "#285ac8")
    response = client.post("/api/characters", json={"name": "Avatar", "avatar_data_url": original})
    assert response.status_code == 200, response.text
    character_id = response.json()["id"]
    first_thumbnail = _stored_thumbnail(testing_session, character_id)
    assert first_thumbnail and first_thumbnail.startswith("data:image/webp;base64,")
    assert encode.call_count == 1

    for patch in (
        {"name": "Renamed Avatar"},
        {"avatar_data_url": original},
        {"avatar_original_data_url": replacement},
        {"avatar_transform": {"scale": 2}},
    ):
        response = client.patch(f"/api/characters/{character_id}", json=patch)
        assert response.status_code == 200, response.text
        assert _stored_thumbnail(testing_session, character_id) == first_thumbnail
        assert encode.call_count == 1
    assert client.get("/api/characters").json()[0]["name"] == "Renamed Avatar"
    assert encode.call_count == 1

    response = client.patch(f"/api/characters/{character_id}", json={"avatar_data_url": replacement})
    assert response.status_code == 200, response.text
    assert response.json()["avatar_data_url"] == replacement
    replacement_thumbnail = _stored_thumbnail(testing_session, character_id)
    assert replacement_thumbnail != first_thumbnail
    assert replacement_thumbnail and replacement_thumbnail.startswith("data:image/webp;base64,")
    assert encode.call_count == 2
    assert client.get("/api/characters").json()[0]["avatar_data_url"] == replacement_thumbnail

    response = client.patch(f"/api/characters/{character_id}", json={"avatar_data_url": None})
    assert response.status_code == 200, response.text
    assert response.json()["avatar_data_url"] is None
    assert _stored_thumbnail(testing_session, character_id) is None
    assert client.get("/api/characters").json()[0]["avatar_data_url"] is None
    assert encode.call_count == 2


def test_png_character_upload_persists_thumbnail(avatar_api):
    client, testing_session, _ = avatar_api
    png = _character_png()
    original = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    response = client.post("/api/characters/import", files={"file": ("avatar.png", png, "image/png")})
    assert response.status_code == 200, response.text
    character = response.json()
    assert character["name"] == "PNG Avatar"
    assert character["avatar_data_url"] == original
    assert character["avatar_original_data_url"] == original
    stored = _stored_thumbnail(testing_session, character["id"])
    assert stored == thumbnail_data_url(original)
    assert client.get("/api/characters").json()[0]["avatar_data_url"] == stored


def test_chub_character_import_persists_thumbnail_without_network(avatar_api, monkeypatch):
    client, testing_session, _ = avatar_api
    original = _png_data_url(256)

    async def import_character(reference):
        assert reference == "characters/test/avatar"
        return schemas.CharacterCreate(name="Chub Avatar", avatar_data_url=original)

    monkeypatch.setattr(chub_import, "import_chub_character", import_character)
    response = client.post("/api/characters/import/chub", json={"url_or_path": "characters/test/avatar"})
    assert response.status_code == 200, response.text
    character = response.json()
    assert character["avatar_data_url"] == original
    stored = _stored_thumbnail(testing_session, character["id"])
    assert stored == thumbnail_data_url(original)
    assert client.get("/api/characters").json()[0]["avatar_data_url"] == stored


def test_directory_character_import_persists_thumbnail(avatar_api):
    client, testing_session, _ = avatar_api
    png = _character_png()
    original = "data:image/png;base64," + base64.b64encode(png).decode("ascii")
    plan = build_plan(
        {"settings.json": b"{}", "characters/avatar.png": png},
        {"omitted": {}},
        "test:avatar-directory-import",
    )
    assert not plan.errors, plan.errors
    with testing_session() as db:
        report = apply_plan(db, plan)
    assert report["created"]["character"] == 1
    character_id = resource_id(plan.source, "character", "characters/avatar.png")
    stored = _stored_thumbnail(testing_session, character_id)
    assert stored == thumbnail_data_url(original)
    response = client.get(f"/api/characters/{character_id}")
    assert response.status_code == 200, response.text
    assert response.json()["avatar_data_url"] == original
    assert response.json()["avatar_original_data_url"] == original
    assert client.get("/api/characters").json()[0]["avatar_data_url"] == stored
