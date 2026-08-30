import base64
import io
import json
import struct
import zlib

from PIL import Image, PngImagePlugin

from app.services.st_import import load_character_upload, load_worldbook_upload, normalize_worldbook


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


def test_imports_sillytavern_png_with_text_chunks_after_idat():
    raw = {"spec": "chara_card_v3", "spec_version": "3.0", "data": {"name": "璃音"}}
    image = Image.new("RGB", (4, 4), "white")
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    png = buffer.getvalue()

    payload = base64.b64encode(json.dumps(raw, ensure_ascii=False).encode("utf-8"))
    chunk_data = b"ccv3\x00" + payload
    chunk_type = b"tEXt"
    text_chunk = (
        struct.pack(">I", len(chunk_data))
        + chunk_type
        + chunk_data
        + struct.pack(">I", zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF)
    )
    iend_offset = png.rfind(b"\x00\x00\x00\x00IEND")
    assert iend_offset > 0
    st_png = png[:iend_offset] + text_chunk + png[iend_offset:]

    card = load_character_upload("鈴谷 璃音.png", st_png)
    assert card.name == "璃音"


def test_png_falls_back_to_valid_chara_when_ccv3_is_damaged():
    raw = {"spec": "chara_card_v2", "data": {"name": "Fallback Card"}}
    image = Image.new("RGB", (4, 4), "white")
    meta = PngImagePlugin.PngInfo()
    meta.add_text("ccv3", "not valid card metadata")
    meta.add_text("chara", base64.b64encode(json.dumps(raw).encode("utf-8")).decode("ascii"))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", pnginfo=meta)

    card = load_character_upload("fallback.png", buffer.getvalue())
    assert card.name == "Fallback Card"


def test_worldbook_without_name_uses_uploaded_filename():
    book = load_worldbook_upload(b'{"entries": {}}', filename="帝都设定.json")
    assert book.name == "帝都设定"


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
