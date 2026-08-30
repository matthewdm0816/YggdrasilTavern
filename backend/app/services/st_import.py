from __future__ import annotations

import base64
import binascii
import io
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List

from fastapi import HTTPException
from PIL import Image

from .. import schemas


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return [str(value)]


def _decode_card_payload(value: str) -> Dict[str, Any]:
    errors: List[str] = []
    candidates = list(dict.fromkeys((value, value.strip(), "".join(value.split()))))
    for candidate in candidates:
        if not candidate:
            continue
        try:
            decoded = base64.b64decode(candidate, validate=True).decode("utf-8")
            parsed = json.loads(decoded)
            if not isinstance(parsed, dict):
                raise ValueError("decoded JSON root is not an object")
            return parsed
        except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            errors.append(f"base64 JSON: {exc}")
    try:
        parsed = json.loads(value)
        if not isinstance(parsed, dict):
            raise ValueError("JSON root is not an object")
        return parsed
    except (json.JSONDecodeError, ValueError) as exc:
        errors.append(f"plain JSON: {exc}")
    detail = "; ".join(dict.fromkeys(errors))
    raise HTTPException(
        status_code=400,
        detail=f"PNG character metadata is not valid JSON/base64 JSON ({detail})",
    )


def read_png_character_card(content: bytes) -> Dict[str, Any]:
    try:
        image = Image.open(io.BytesIO(content))
        # SillyTavern writes its chara/ccv3 tEXt chunks after IDAT. Pillow only
        # scans chunks after the image stream when the image is fully loaded,
        # so Image.open() alone leaves image.info empty for valid ST exports.
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Could not read PNG character card") from exc

    payloads = [(key, image.info.get(key)) for key in ("ccv3", "chara") if image.info.get(key)]
    if not payloads:
        raise HTTPException(status_code=400, detail="PNG has no ccv3/chara metadata")
    failures: List[str] = []
    for key, payload in payloads:
        if isinstance(payload, bytes):
            try:
                payload = payload.decode("utf-8")
            except UnicodeDecodeError as exc:
                failures.append(f"{key}: metadata is not UTF-8 ({exc})")
                continue
        try:
            return _decode_card_payload(str(payload))
        except HTTPException as exc:
            failures.append(f"{key}: {exc.detail}")
    raise HTTPException(
        status_code=400,
        detail="PNG character metadata could not be decoded: " + "; ".join(failures),
    )


def normalize_character(raw: Dict[str, Any], avatar_data_url: str | None = None) -> schemas.CharacterCreate:
    data = raw.get("data") if raw.get("spec") in {"chara_card_v2", "chara_card_v3"} else raw
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Character card data is invalid")
    name = str(data.get("name") or raw.get("name") or "Unnamed Character")
    return schemas.CharacterCreate(
        name=name,
        description=str(data.get("description", "")),
        personality=str(data.get("personality", "")),
        scenario=str(data.get("scenario", "")),
        first_mes=str(data.get("first_mes", "")),
        mes_example=str(data.get("mes_example", "")),
        creator_notes=str(data.get("creator_notes", "")),
        system_prompt=str(data.get("system_prompt", "")),
        post_history_instructions=str(data.get("post_history_instructions", "")),
        alternate_greetings=_as_list(data.get("alternate_greetings")),
        tags=_as_list(data.get("tags")),
        creator=str(data.get("creator", "")),
        character_version=str(data.get("character_version", "")),
        avatar_data_url=avatar_data_url,
        raw_json=raw,
        extensions=data.get("extensions") if isinstance(data.get("extensions"), dict) else {},
        character_book=data.get("character_book") if isinstance(data.get("character_book"), dict) else None,
    )


def load_character_upload(filename: str, content: bytes) -> schemas.CharacterCreate:
    lower = filename.lower()
    avatar_data_url = None
    if lower.endswith(".png"):
        raw = read_png_character_card(content)
        avatar_data_url = "data:image/png;base64," + base64.b64encode(content).decode("ascii")
    else:
        try:
            raw = json.loads(content.decode("utf-8"))
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Character JSON is invalid") from exc
    return normalize_character(raw, avatar_data_url=avatar_data_url)


def character_to_v2_json(character: Any) -> Dict[str, Any]:
    data = {
        "name": character.name,
        "description": character.description,
        "personality": character.personality,
        "scenario": character.scenario,
        "first_mes": character.first_mes,
        "mes_example": character.mes_example,
        "creator_notes": character.creator_notes,
        "system_prompt": character.system_prompt,
        "post_history_instructions": character.post_history_instructions,
        "alternate_greetings": list(character.alternate_greetings or []),
        "tags": list(character.tags or []),
        "creator": character.creator,
        "character_version": character.character_version,
        "extensions": dict(character.extensions or {}),
    }
    if character.character_book:
        data["character_book"] = character.character_book
    return {"spec": "chara_card_v2", "spec_version": "2.0", "data": data}


def _iter_worldbook_entries(raw: Dict[str, Any]) -> Iterable[Dict[str, Any]]:
    entries = raw.get("entries") or raw.get("world_info") or raw.get("lorebook", {}).get("entries", [])
    if isinstance(entries, dict):
        for uid, entry in entries.items():
            if isinstance(entry, dict):
                with_uid = dict(entry)
                with_uid.setdefault("uid", str(uid))
                yield with_uid
    elif isinstance(entries, list):
        for entry in entries:
            if isinstance(entry, dict):
                yield entry


def normalize_worldbook(
    raw: Dict[str, Any],
    *,
    fallback_name: str = "Imported Worldbook",
) -> schemas.WorldBookCreate:
    entries = []
    for raw_entry in _iter_worldbook_entries(raw):
        keys = raw_entry.get("keys", raw_entry.get("key", []))
        secondary = raw_entry.get("secondary_keys", raw_entry.get("keysecondary", []))
        enabled = raw_entry.get("enabled")
        if enabled is None:
            enabled = not bool(raw_entry.get("disable", False))
        entries.append(
            schemas.WorldBookEntryCreate(
                uid=str(raw_entry.get("uid", "")) or None,
                keys=_as_list(keys),
                secondary_keys=_as_list(secondary),
                content=str(raw_entry.get("content", "")),
                enabled=bool(enabled),
                constant=bool(raw_entry.get("constant", False)),
                selective=bool(raw_entry.get("selective", False)),
                order=int(raw_entry.get("insertion_order", raw_entry.get("order", 100)) or 100),
                position=str(raw_entry.get("position", "after_char")),
                depth=raw_entry.get("depth"),
                case_sensitive=bool(raw_entry.get("case_sensitive", False)),
                match_whole_words=bool(raw_entry.get("match_whole_words", False)),
                raw_json=raw_entry,
            )
        )
    return schemas.WorldBookCreate(
        name=str(raw.get("name") or raw.get("display_name") or fallback_name),
        description=str(raw.get("description", "")),
        scan_depth=int(raw.get("scan_depth", 8) or 8),
        token_budget=int(raw.get("token_budget", raw.get("budget", 4000)) or 4000),
        recursive_scanning=bool(raw.get("recursive_scanning", raw.get("recursive", False))),
        raw_json=raw,
        entries=entries,
    )


def load_worldbook_upload(content: bytes, filename: str | None = None) -> schemas.WorldBookCreate:
    try:
        raw = json.loads(content.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Worldbook JSON is invalid") from exc
    uploaded_name = filename.replace("\\", "/").rsplit("/", 1)[-1] if filename else ""
    filename_stem = Path(uploaded_name).stem.strip() if uploaded_name else ""
    return normalize_worldbook(raw, fallback_name=filename_stem or "Imported Worldbook")
