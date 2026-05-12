from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Literal
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from .. import schemas
from .st_import import normalize_character, normalize_worldbook

CHUB_API_BASE = "https://api.chub.ai"


@dataclass
class ChubReference:
    namespace: Literal["characters", "lorebooks"]
    creator: str
    project: str


def parse_chub_reference(value: str, expected: Literal["characters", "lorebooks"]) -> ChubReference:
    text = value.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Chub URL/path is empty")
    parsed = urlparse(text if "://" in text else "https://chub.ai/" + text.lstrip("/"))
    parts = [part for part in parsed.path.strip("/").split("/") if part]
    aliases = {
        "character": "characters",
        "characters": "characters",
        "lorebook": "lorebooks",
        "lorebooks": "lorebooks",
        "worldbook": "lorebooks",
        "worldbooks": "lorebooks",
    }
    if len(parts) < 3 or parts[0].lower() not in aliases:
        raise HTTPException(status_code=400, detail="Expected a Chub path like characters/user/slug or lorebooks/user/slug")
    namespace = aliases[parts[0].lower()]
    if namespace != expected:
        raise HTTPException(status_code=400, detail=f"Expected a {expected} Chub URL/path")
    return ChubReference(namespace=namespace, creator=parts[1], project=parts[2])


async def fetch_chub_project(reference: ChubReference) -> Dict[str, Any]:
    path = f"/api/public/{reference.namespace}/{reference.creator}/{reference.project}"
    urls = [
        f"{CHUB_API_BASE}{path}?full=true",
        f"{CHUB_API_BASE}{path}",
        f"{CHUB_API_BASE}/api/{reference.namespace}/{reference.creator}/{reference.project}?full=true",
    ]
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        errors = []
        for url in urls:
            response = await client.get(url, headers={"accept": "application/json"})
            if response.status_code == 200:
                try:
                    return response.json()
                except ValueError as exc:
                    raise HTTPException(status_code=502, detail="Chub returned non-JSON project data") from exc
            errors.append(f"{response.status_code} {url}")
    raise HTTPException(status_code=404, detail="Could not fetch Chub project: " + "; ".join(errors))


def _node(project: Dict[str, Any]) -> Dict[str, Any]:
    node = project.get("node")
    if isinstance(node, dict):
        return node
    return project


def _definition(project: Dict[str, Any]) -> Dict[str, Any]:
    node = _node(project)
    definition = node.get("definition") or project.get("definition") or {}
    if isinstance(definition, dict):
        return definition
    return {}


def chub_project_to_character(project: Dict[str, Any]) -> schemas.CharacterCreate:
    node = _node(project)
    definition = _definition(project)
    if definition.get("spec") or definition.get("data") or definition.get("first_mes"):
        card = normalize_character(definition)
        card.avatar_data_url = node.get("max_res_url") or node.get("avatar_url") or card.avatar_data_url
        card.raw_json = project
        return card

    data = {
        "name": definition.get("name") or node.get("name") or "Imported Chub Character",
        "description": definition.get("personality") or node.get("description") or "",
        "personality": definition.get("tavern_personality") or "",
        "scenario": definition.get("scenario") or "",
        "first_mes": definition.get("first_message") or definition.get("first_mes") or "",
        "mes_example": definition.get("example_dialogs") or definition.get("mes_example") or "",
        "creator_notes": definition.get("description") or node.get("tagline") or "",
        "system_prompt": definition.get("system_prompt") or "",
        "post_history_instructions": definition.get("post_history_instructions") or "",
        "alternate_greetings": definition.get("alternate_greetings") or [],
        "tags": node.get("topics") or definition.get("tags") or [],
        "creator": node.get("fullPath", "").split("/")[1] if "/" in str(node.get("fullPath", "")) else "",
        "character_version": definition.get("version") or "",
        "avatar_data_url": node.get("max_res_url") or node.get("avatar_url"),
        "raw_json": project,
        "extensions": definition.get("extensions") if isinstance(definition.get("extensions"), dict) else {},
        "character_book": definition.get("character_book") if isinstance(definition.get("character_book"), dict) else None,
    }
    return schemas.CharacterCreate(**data)


def chub_project_to_worldbook(project: Dict[str, Any]) -> schemas.WorldBookCreate:
    node = _node(project)
    definition = _definition(project)
    raw_book = definition.get("book") if isinstance(definition.get("book"), dict) else definition
    if not isinstance(raw_book, dict) or not raw_book:
        raw_book = {}
    raw = {
        **raw_book,
        "name": raw_book.get("name") or node.get("name") or "Imported Chub Worldbook",
        "description": raw_book.get("description") or node.get("description") or node.get("tagline") or "",
        "raw_chub_project": project,
    }
    worldbook = normalize_worldbook(raw)
    worldbook.raw_json = project
    return worldbook


async def import_chub_character(url_or_path: str) -> schemas.CharacterCreate:
    reference = parse_chub_reference(url_or_path, "characters")
    return chub_project_to_character(await fetch_chub_project(reference))


async def import_chub_worldbook(url_or_path: str) -> schemas.WorldBookCreate:
    reference = parse_chub_reference(url_or_path, "lorebooks")
    return chub_project_to_worldbook(await fetch_chub_project(reference))
