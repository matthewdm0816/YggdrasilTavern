import base64
import io
import json

from PIL import Image, PngImagePlugin

from app.services.st_import import load_character_upload, normalize_worldbook


def test_imports_character_card_v2_json():
    raw = {
        "spec": "chara_card_v2",
        "data": {
            "name": "Luna",
            "description": "A moonlit guide.",
            "first_mes": "Welcome.",
            "alternate_greetings": ["Hi again."],
            "extensions": {"source": "test"},
        },
    }
    card = load_character_upload("luna.json", json.dumps(raw).encode("utf-8"))
    assert card.name == "Luna"
    assert card.alternate_greetings == ["Hi again."]
    assert card.extensions == {"source": "test"}


def test_imports_png_character_metadata():
    raw = {"spec": "chara_card_v2", "data": {"name": "Png Luna", "first_mes": "PNG hi"}}
    image = Image.new("RGB", (4, 4), "white")
    meta = PngImagePlugin.PngInfo()
    meta.add_text("chara", base64.b64encode(json.dumps(raw).encode("utf-8")).decode("ascii"))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", pnginfo=meta)

    card = load_character_upload("luna.png", buffer.getvalue())
    assert card.name == "Png Luna"
    assert card.avatar_data_url and card.avatar_data_url.startswith("data:image/png;base64,")


def test_imports_worldbook_entries_from_st_shape():
    raw = {
        "name": "Lore",
        "entries": {
            "7": {
                "key": ["moon"],
                "keysecondary": ["gate"],
                "content": "Moon gates are rare.",
                "selective": True,
                "insertion_order": 12,
            }
        },
    }
    book = normalize_worldbook(raw)
    assert book.name == "Lore"
    assert book.entries[0].uid == "7"
    assert book.entries[0].keys == ["moon"]
    assert book.entries[0].secondary_keys == ["gate"]
    assert book.entries[0].order == 12
