"""SillyTavern configuration conversion and an atomic, additive import.

The plan is private: credentials and character images must never be serialized
as an API report. Public reports contain counts and redacted diagnostics only.
"""

from __future__ import annotations

import base64
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from typing import Any
from urllib.parse import urlsplit
import uuid

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import inspect, select, update
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session

from .. import models, schemas
from .prompt_config import default_prompt_slots, normalize_prompt_slots, normalize_regex_rules
from .st_import import load_character_upload, normalize_worldbook

NAMESPACE = uuid.UUID("ff576c5c-cb14-451b-a36d-23eac5818d67")
MARKERS = {
    "main": "main", "jailbreak": "post_history", "worldInfoBefore": "world_before",
    "worldInfoAfter": "world_after", "charDescription": "char_description",
    "charPersonality": "char_personality", "scenario": "scenario",
    "dialogueExamples": "examples", "chatHistory": "history",
}
# Provider families supported by the existing Yggdrasil request adapters.
PROVIDERS = {
    "custom": ("openai_chat_completions", None, "custom_model", "api_key_custom"),
    "openai": ("openai_chat_completions", "https://api.openai.com/v1", "openai_model", "api_key_openai"),
    "claude": ("anthropic_messages", "https://api.anthropic.com/v1", "claude_model", "api_key_claude"),
    "openrouter": ("openai_chat_completions", "https://openrouter.ai/api/v1", "openrouter_model", "api_key_openrouter"),
    "deepseek": ("openai_chat_completions", "https://api.deepseek.com", "deepseek_model", "api_key_deepseek"),
    "groq": ("openai_chat_completions", "https://api.groq.com/openai/v1", "groq_model", "api_key_groq"),
    "mistralai": ("openai_chat_completions", "https://api.mistral.ai/v1", "mistralai_model", "api_key_mistralai"),
    "xai": ("openai_chat_completions", "https://api.x.ai/v1", "xai_model", "api_key_xai"),
    "moonshot": ("openai_chat_completions", "https://api.moonshot.ai/v1", "moonshot_model", "api_key_moonshot"),
}


def resource_id(source: str, kind: str, key: str) -> str:
    return str(uuid.uuid5(NAMESPACE, json.dumps([source, kind, key], ensure_ascii=False)))


def content_hash(content: Any) -> str:
    if not isinstance(content, bytes):
        content = json.dumps(content, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(content).hexdigest()


@dataclass(repr=False)
class ImportItem:
    kind: str
    key: str
    name: str
    digest: str
    payload: dict = field(default_factory=dict)
    raw: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass(repr=False)
class ImportPlan:
    source: str
    items: list[ImportItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    omitted: dict = field(default_factory=dict)
    defaults: dict = field(default_factory=dict)
    active_prompt_key: str | None = None
    active_profile_key: str | None = None


def _json_object(content: bytes, key: str) -> dict:
    try:
        raw = json.loads(content.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"{key} 不是有效的 UTF-8 JSON") from exc
    if not isinstance(raw, dict):
        raise ValueError(f"{key} 的 JSON 根节点必须是对象")
    return raw


def _secrets(raw: dict) -> dict[str, list[dict]]:
    result = {}
    for kind, values in raw.items():
        if kind == "_migrated":
            continue
        if isinstance(values, str):
            values = [{"id": "legacy", "label": "原有密钥", "active": True, "value": values}]
        if not isinstance(values, list):
            raise ValueError(f"secrets.json 中 {kind} 的密钥列表格式无效")
        result[kind] = []
        for index, value in enumerate(values):
            if not isinstance(value, dict) or not isinstance(value.get("value"), str):
                raise ValueError(f"secrets.json 中 {kind} 的第 {index + 1} 把密钥格式无效")
            if value["value"].strip():
                result[kind].append({**value, "id": str(value.get("id") or index)})
    return result


def _redactor(secret_values: list[str]):
    values = sorted(set(secret_values), key=len, reverse=True)

    def redact(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: "[REDACTED]" if re.search(
                    r"api[_-]?key|password|authorization|access[_-]?token|^secret$|^key$", key, re.I
                ) else redact(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [redact(item) for item in value]
        if isinstance(value, str):
            for secret in values:
                if value == secret:
                    return "[REDACTED]"
                if len(secret) >= 6:
                    value = value.replace(secret, "[REDACTED]")
            return value
        return value

    return redact


def _sampling(raw: dict, provider_type: str = "openai_chat_completions") -> dict:
    mappings = {
        "temperature": ("temperature", "temp_openai"),
        "top_p": ("top_p", "top_p_openai"),
        "frequency_penalty": ("frequency_penalty", "freq_pen_openai"),
        "presence_penalty": ("presence_penalty", "pres_pen_openai"),
    }
    result = {}
    for target, sources in mappings.items():
        if provider_type == "anthropic_messages" and target in {"frequency_penalty", "presence_penalty"}:
            continue
        value = next((raw[key] for key in sources if key in raw), None)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            result[target] = value
    if isinstance(raw.get("seed"), int) and raw["seed"] >= 0 and provider_type != "anthropic_messages":
        result["seed"] = raw["seed"]
    effort = raw.get("reasoning_effort")
    if effort in {"low", "medium", "high", "xhigh", "max"}:
        result["_thinking_level"] = effort
    return result


def convert_prompt(raw: dict, persona: str = "") -> tuple[list[dict], list[str]]:
    warnings = []
    prompts = raw.get("prompts", [])
    if not isinstance(prompts, list) or any(not isinstance(p, dict) for p in prompts):
        raise ValueError("prompts 必须是对象列表")
    by_id = {str(p.get("identifier")): p for p in prompts if p.get("identifier")}
    orders = raw.get("prompt_order") or []
    if not isinstance(orders, list):
        raise ValueError("prompt_order 必须是列表")
    selected = next((o for o in orders if o.get("character_id") == 100001), None)
    selected = selected or next((o for o in orders if o.get("character_id") == 100000), None)
    selected = selected or (orders[-1] if orders else {})
    order = selected.get("order", [])
    if not isinstance(order, list):
        raise ValueError("提示词顺序必须是列表")
    if any(o.get("character_id") not in {100000, 100001} for o in orders):
        warnings.append("角色专属提示词顺序仅保留原始数据；目前使用全局提示词顺序")
    if not order:
        order = [{"identifier": key, "enabled": p.get("enabled", True)} for key, p in by_id.items()]
    defaults = {slot["id"]: slot for slot in default_prompt_slots()}
    slots = []
    used = set()
    for entry in order:
        identifier = str(entry.get("identifier", ""))
        if identifier in used:
            raise ValueError("提示词顺序包含重复 identifier")
        used.add(identifier)
        prompt = by_id.get(identifier)
        if prompt is None:
            warnings.append(f"提示词顺序中的 {identifier} 没有对应定义，未启用")
            continue
        kind = MARKERS.get(identifier, "custom")
        slot = dict(defaults[kind]) if kind != "custom" else {
            "id": "st:" + str(uuid.uuid5(NAMESPACE, identifier)), "kind": "custom",
        }
        enabled = bool(entry.get("enabled", True))
        if prompt.get("injection_position", 0) != 0 or prompt.get("injection_trigger"):
            enabled = False
            warnings.append(f"提示词 {prompt.get('name') or identifier} 使用消息深度或条件注入，保留文本但禁用")
        if prompt.get("marker"):
            content = persona if identifier == "personaDescription" else None
            if identifier not in MARKERS and identifier != "personaDescription":
                enabled = False
                warnings.append(f"不支持的提示词 marker {identifier}，已禁用")
        else:
            content = str(prompt.get("content") or "")
        role = prompt.get("role", "system")
        if role not in {"system", "user", "assistant"}:
            raise ValueError(f"提示词 {identifier} 的 role 无效")
        slot.update(name=str(prompt.get("name") or identifier), enabled=enabled, role=role, content=content)
        slots.append(slot)
    for kind, slot in defaults.items():
        if not any(existing["kind"] == kind for existing in slots):
            slots.append({**slot, "enabled": False})
    # Unselected custom prompts remain available for the editor without running.
    for identifier, prompt in by_id.items():
        if identifier not in used and identifier not in MARKERS and not prompt.get("marker"):
            slots.append({
                "id": "st:" + str(uuid.uuid5(NAMESPACE, identifier)), "kind": "custom",
                "name": str(prompt.get("name") or identifier), "enabled": False,
                "role": prompt.get("role", "system"), "content": str(prompt.get("content") or ""),
            })
    if not prompts:
        slots = default_prompt_slots()
        warnings.append("没有 Chat Completion 提示词定义，保留默认提示词顺序")
    known = {"char", "user", "description", "personality", "scenario", "charFirstMessage", "original"}
    unknown = sorted({macro for slot in slots if slot["enabled"] for macro in re.findall(
        r"\{\{([^{}]+)\}\}", slot.get("content") or ""
    ) if macro not in known and not re.fullmatch(r"charFirstMessage::\d+", macro)})
    if unknown:
        warnings.append("启用的提示词包含尚不支持的宏，保留原文：" + ", ".join(unknown))
    return normalize_prompt_slots(slots), warnings


def convert_regex(scripts: list) -> tuple[list[dict], list[str]]:
    rules, warnings = [], []
    for index, script in enumerate(scripts):
        name = str(script.get("scriptName") or f"Regex {index + 1}")
        # ST placement is role-specific. Yggdrasil display rules currently apply
        # to every role, so never silently broaden a user-only regex.
        if (set(script.get("placement", [])) != {1, 2}
                or script.get("minDepth") is not None or script.get("maxDepth") is not None
                or script.get("trimStrings") or script.get("substituteRegex", 0)):
            warnings.append(f"正则规则 {name} 有消息角色、深度或宏限制，仅保留原始配置")
            continue
        if not script.get("markdownOnly") or script.get("promptOnly"):
            warnings.append(f"正则规则 {name} 不能等价转换为显示规则，仅保留原始配置")
            continue
        match = re.fullmatch(r"/(.*)/([gims]*)", str(script.get("findRegex", "")), re.S)
        if match:
            pattern, flags = match.groups()
        else:
            pattern, flags = str(script.get("findRegex", "")), ""
        rule = {
            "id": "st:" + str(uuid.uuid5(NAMESPACE, str(script.get("id") or index))),
            "name": name, "enabled": not script.get("disabled", False), "scope": "global",
            "targets": ["display"], "mode": "replace", "pattern": pattern,
            "flags": flags, "replacement": str(script.get("replaceString") or ""),
        }
        rules.extend(normalize_regex_rules([rule]))
    return rules, warnings


def build_plan(files: dict[str, bytes], manifest: dict, source: str) -> ImportPlan:
    plan = ImportPlan(source=source, omitted=manifest.get("omitted", {}))
    if "settings.json" not in files:
        raise ValueError("没有 settings.json")
    settings = _json_object(files["settings.json"], "settings.json")
    secrets = _secrets(_json_object(files.get("secrets.json", b"{}"), "secrets.json"))
    secret_values = [value["value"] for values in secrets.values() for value in values]
    oai = settings.get("oai_settings") or {}
    extensions = settings.get("extension_settings") or {}
    power = settings.get("power_user") or {}
    for value in (oai.get("proxy_password"), extensions.get("apiKey")):
        if isinstance(value, str) and value:
            secret_values.append(value)
    for proxy in settings.get("proxies") or []:
        if isinstance(proxy, dict) and isinstance(proxy.get("password"), str) and proxy["password"]:
            secret_values.append(proxy["password"])
    redact = _redactor(secret_values)
    for link in manifest.get("links", []):
        plan.warnings.append(f"跳过符号链接：{link}")

    def add(kind, key, name, raw, payload=None, warnings=None, digest=None):
        plan.items.append(ImportItem(
            kind, key, redact(name), digest or content_hash(raw), payload or {},
            redact(raw), redact(warnings or []),
        ))

    for kind, values in secrets.items():
        for value in values:
            key = kind + ":" + value["id"]
            add("credential", key, f"{kind} · {value.get('label') or value['id']}", {}, {
                "secret_type": kind, "api_key": value["value"].strip(),
            }, digest=content_hash(value))

    add("settings", "settings.json", "SillyTavern 原始设置（密钥已移除）", settings)
    selected_persona = str(power.get("persona_description") or "")
    world_settings = settings.get("world_info_settings") or {}
    world_info = world_settings.get("world_info") or {}
    selected_worlds = world_info.get("globalSelect", []) if isinstance(world_info, dict) else []
    plan.defaults = {"user_name": str(settings.get("username") or "User"), "worldbook_ids": []}
    regex, regex_warnings = convert_regex(extensions.get("regex") or [])
    plan.defaults["regex_rules"] = regex
    if extensions.get("regex"):
        add("regex", "global", "SillyTavern 全局正则规则", {"scripts": extensions["regex"]},
            {"regex_rules": regex}, regex_warnings)
    for avatar, name in (power.get("personas") or {}).items():
        info = (power.get("persona_descriptions") or {}).get(avatar, {})
        avatar_content = files.get("User Avatars/" + avatar)
        avatar_url = None
        if avatar_content:
            suffix = Path(avatar).suffix.lower()
            mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}.get(suffix)
            if mime:
                avatar_url = f"data:{mime};base64," + base64.b64encode(avatar_content).decode("ascii")
        add("persona", avatar, str(name), info, {
            "user_name": str(name), "description": str(info.get("description") or ""),
            "avatar_data_url": avatar_url,
        }, ["用户头像和描述已保存；头像显示及描述位置尚未接入会话界面"])

    presets = {}
    for key, content in sorted(files.items()):
        path = Path(key)
        directory = key.split("/")[0]
        try:
            if directory == "characters" and len(path.parts) == 2 and path.suffix.lower() in {".png", ".json"}:
                character = load_character_upload(path.name, content)
                payload = character.model_dump()
                payload["raw_json"] = redact(payload["raw_json"])
                payload["extensions"] = redact(payload["extensions"])
                payload["avatar_original_data_url"] = payload["avatar_data_url"]
                add("character", key, character.name, character.raw_json, payload, digest=content_hash(content))
            elif directory == "worlds" and path.suffix.lower() == ".json":
                raw = _json_object(content, key)
                merged = dict(raw)
                merged.setdefault("scan_depth", world_settings.get("world_info_depth", 8))
                if not merged.get("token_budget"):
                    cap = world_settings.get("world_info_budget_cap", 0)
                    percentage = world_settings.get("world_info_budget", 25)
                    merged["token_budget"] = int(cap or int(oai.get("openai_max_context", 16384)) * percentage / 100)
                payload = normalize_worldbook(merged, fallback_name=path.stem).model_dump()
                payload["raw_json"] = raw
                warnings = []
                if world_settings.get("world_info_recursive"):
                    warnings.append("递归世界书扫描尚未支持；当前使用关键词扫描")
                for entry in payload["entries"]:
                    source_entry = entry["raw_json"]
                    # ST depth is an injection position; scanDepth controls
                    # keyword matching. Do not treat injection depth as scan depth.
                    entry["depth"] = source_entry.get("scanDepth")
                    for normalized, original, global_key in (
                        ("case_sensitive", "caseSensitive", "world_info_case_sensitive"),
                        ("match_whole_words", "matchWholeWords", "world_info_match_whole_words"),
                    ):
                        value = source_entry.get(original, source_entry.get(normalized))
                        entry[normalized] = bool(value if value is not None else world_settings.get(global_key, False))
                    if entry["position"] not in {"0", "1", "before_char", "after_char", "before_char_defs"}:
                        entry["enabled"] = False
                        warnings.append("存在消息深度等不支持的世界书插入位置，对应条目已禁用并保留原文")
                    if entry["raw_json"].get("useProbability") and entry["raw_json"].get("probability", 100) != 100:
                        entry["enabled"] = False
                        warnings.append("存在按概率触发的条目，对应条目已禁用并保留原文")
                    if entry["selective"] and entry["raw_json"].get("selectiveLogic", 0) != 0:
                        entry["enabled"] = False
                        warnings.append("存在不支持的次要关键词逻辑，对应条目已禁用并保留原文")
                add("worldbook", key, payload["name"], raw, payload, sorted(set(warnings)), content_hash(content))
                if path.stem in selected_worlds:
                    plan.defaults["worldbook_ids"].append(resource_id(source, "worldbook", key))
            elif directory == "OpenAI Settings" and path.suffix.lower() == ".json":
                raw = _json_object(content, key)
                presets[path.stem] = raw
                slots, warnings = convert_prompt(raw, selected_persona)
                add("prompt", key, path.stem, raw, {"prompt_slots": slots, "parameters": _sampling(raw)}, warnings)
            elif directory == "sysprompt" and path.suffix.lower() == ".json":
                raw = _json_object(content, key)
                slots = default_prompt_slots()
                slots[0]["content"] = str(raw.get("content") or "")
                slots[-1]["content"] = str(raw.get("post_history") or "")
                add("prompt", key, "系统提示词 / " + str(raw.get("name") or path.stem), raw,
                    {"prompt_slots": normalize_prompt_slots(slots), "parameters": {}})
            elif key not in {"settings.json", "secrets.json"} and path.suffix.lower() == ".json":
                raw = _json_object(content, key)
                add("archive", key, f"{directory} / {path.stem}", raw, warnings=[
                    "仅保存原始配置：Yggdrasil Tavern 暂不支持这类模板、界面或扩展设置",
                ], digest=content_hash(content))
        except (ValueError, TypeError, AttributeError, ValidationError, HTTPException) as exc:
            if isinstance(exc, ValidationError):
                detail = "; ".join(f"{e['loc']}: {e['msg']}" for e in exc.errors())
            elif isinstance(exc, HTTPException):
                detail = str(exc.detail)
            else:
                detail = str(exc)
            plan.errors.append(redact(f"{key}：{detail}"))

    slots, warnings = convert_prompt(oai, selected_persona)
    active_prompt_key = "settings.json:oai_settings"
    add("prompt", active_prompt_key, "SillyTavern 当前提示词", oai,
        {"prompt_slots": slots, "parameters": _sampling(oai)}, warnings)
    plan.active_prompt_key = active_prompt_key
    manager = extensions.get("connectionManager") or {}
    profiles = manager.get("profiles") or []
    selected_profile = manager.get("selectedProfile")

    def make_profile(raw, key, active=False):
        name = str(raw.get("name") or "SillyTavern 当前连接")
        api = oai.get("chat_completion_source") if active else raw.get("api")
        mode = "cc" if active and settings.get("main_api") == "openai" else raw.get("mode")
        if mode != "cc" or api not in PROVIDERS:
            add("connection", key, name, raw, warnings=[
                "未创建可用 API 配置：连接仅保存模型切换，或使用尚不支持的协议；地址与密钥不会猜测",
            ])
            return
        provider, base_url, model_field, secret_type = PROVIDERS[api]
        preset = oai if active else presets.get(raw.get("preset"), {})
        model = oai.get(model_field) if active else raw.get("model")
        if api == "custom":
            base_url = oai.get("custom_url") if active else raw.get("api-url")
        secret_id = None if active else raw.get("secret-id")
        secret_list = secrets.get(secret_type, [])
        credential = next((s for s in secret_list if s["id"] == secret_id), None) if secret_id else next(
            (s for s in secret_list if s.get("active")), None,
        )
        api_key = credential["value"].strip() if credential else None
        warnings = []
        if not active and not secret_id:
            warnings.append("该连接没有固定密钥 ID，使用该服务当前启用的密钥")
        # ST proxy presets can override both URL and password for native APIs.
        proxy_name = settings.get("selected_proxy") if active else raw.get("proxy")
        proxy = next((p for p in settings.get("proxies", []) if p.get("name") == proxy_name), None)
        reverse_proxy = (proxy or {}).get("url") or (preset.get("reverse_proxy") if active else None)
        if reverse_proxy and api not in {"custom", "openrouter"}:
            base_url = reverse_proxy
            api_key = (proxy or {}).get("password") or preset.get("proxy_password") or None
        if not base_url or not model or not api_key:
            add("connection", key, name, raw, warnings=[
                "未创建可用 API 配置：没有完整的地址、模型或对应密钥；原始配置已保存",
            ])
            return
        parsed_url = urlsplit(base_url)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc or parsed_url.username or parsed_url.query or parsed_url.fragment:
            raise ValueError(f"连接 {name} 的 URL 格式不适合直接导入")
        path_override = None
        if api == "custom":
            # ST appends /chat/completions to the literal custom URL, including
            # URLs without /v1. Preserve that behavior in Yggdrasil's override.
            path_override = "/chat/completions"
        input_limit = int(preset.get("openai_max_context") or 262144)
        output_limit = int(preset.get("openai_max_tokens") or 32768)
        # ST context window includes its output reservation.
        input_limit = max(1024, input_limit - output_limit)
        payload = schemas.APIProfileCreate(
            name=name, provider_type=provider, base_url=base_url.rstrip("/"), path_override=path_override,
            model=str(model), api_key=api_key, default_params=_sampling(preset, provider),
            input_token_limit=min(input_limit, 8 * 1024 * 1024),
            output_token_limit=min(max(1, output_limit), 1024 * 1024),
        ).model_dump()
        if not active and raw.get("preset") not in presets:
            warnings.append("关联的采样预设未找到，使用 Yggdrasil 默认采样参数")
        for option in ("custom_include_body", "custom_include_headers", "custom_exclude_body"):
            if preset.get(option):
                warnings.append(f"{option} 尚未转换，仅保留原始配置")
        if raw.get("prompt-post-processing") not in {None, "", "none"}:
            warnings.append("SillyTavern 的提示词后处理尚未转换")
        add("profile", key, name, raw, payload, warnings, content_hash({"raw": raw, "payload": payload}))
        if active:
            plan.active_profile_key = key

    for profile in profiles:
        try:
            key = str(profile.get("id") or profile.get("name"))
            make_profile(profile, key)
        except (ValueError, ValidationError, TypeError) as exc:
            detail = "配置字段无效" if isinstance(exc, ValidationError) else str(exc)
            plan.errors.append(redact(f"连接配置 {profile.get('name', '')}：{detail}"))
    make_profile({"name": "SillyTavern 当前连接"}, "settings.json:active", active=True)
    if selected_profile and any(item.kind == "profile" and item.key == selected_profile for item in plan.items):
        # Current live settings can differ from the saved selected connection,
        # so keep the dedicated live snapshot as the default.
        plan.warnings.append("当前实际连接与保存的连接分别导入，新会话默认使用当前实际连接")
    unresolved = set(selected_worlds) - {Path(item.key).stem for item in plan.items if item.kind == "worldbook"}
    if unresolved:
        plan.warnings.append("找不到已启用的世界书：" + ", ".join(sorted(unresolved)))
    plan.warnings.extend(regex_warnings)
    return plan


def plan_report(plan: ImportPlan, db: Session | None = None) -> dict:
    existing = {}
    if db is not None and "imported_resources" in inspect(db.get_bind()).get_table_names():
        existing = {row.id: row for row in db.scalars(select(models.ImportedResource).where(
            models.ImportedResource.source == plan.source,
        ))}
    counts = Counter(item.kind for item in plan.items)
    skipped = Counter()
    warnings = list(plan.warnings)
    for item in plan.items:
        row = existing.get(resource_id(plan.source, item.kind, item.key))
        if row:
            skipped[item.kind] += 1
            if row.content_hash != item.digest:
                warnings.append(f"{item.name} 的远端内容已改变，保留本地版本；没有覆盖")
        if item.kind != "archive":
            warnings.extend(f"{item.name}：{warning}" for warning in item.warnings)
    if counts["archive"]:
        warnings.append(f"{counts['archive']} 份模板、界面或扩展配置仅保存原始数据；可在导入面板查看，尚未作为功能启用")
    return {
        "source": plan.source, "counts": dict(counts), "already_imported": dict(skipped),
        "warnings": sorted(set(warnings)), "errors": plan.errors, "omitted": plan.omitted,
        "can_apply": not plan.errors,
    }


def backup_sqlite(engine: Engine, output_directory: Path) -> Path | None:
    """SQLite's online backup API includes committed WAL data."""
    if engine.dialect.name != "sqlite":
        raise ValueError("自动导入目前要求 SQLite，以便在写入前自动备份")
    if engine.url.database in {None, "", ":memory:"}:
        return None
    output_directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = output_directory / f"before-sillytavern-{stamp}-{uuid.uuid4().hex[:8]}.db"
    with engine.connect() as connection, sqlite3.connect(str(path)) as destination:
        connection.connection.driver_connection.backup(destination)
    return path.resolve()


def apply_plan(db: Session, plan: ImportPlan, *, activate: bool = False, expected_prompt_revision: int | None = None) -> dict:
    if plan.errors:
        raise ValueError("导入预览存在错误；修复后再导入，数据库未写入")
    report = plan_report(plan, db)
    created = Counter()
    try:
        for item in plan.items:
            item_id = resource_id(plan.source, item.kind, item.key)
            if db.get(models.ImportedResource, item_id):
                continue
            entity_id = None
            if item.kind in {"profile", "character", "worldbook", "credential"}:
                entity_id = item_id
                data = dict(item.payload)
                if item.kind == "profile":
                    entity = models.APIProfile(id=item_id, **data)
                elif item.kind == "character":
                    entity = models.Character(id=item_id, **data)
                elif item.kind == "credential":
                    entity = models.SavedCredential(id=item_id, name=item.name, **data)
                else:
                    entries = data.pop("entries")
                    entity = models.WorldBook(id=item_id, **data)
                    entity.entries = [models.WorldBookEntry(**entry) for entry in entries]
                db.add(entity)
            db.add(models.ImportedResource(
                id=item_id, source=plan.source, kind=item.kind, source_key=item.key,
                name=item.name, content_hash=item.digest, entity_id=entity_id, raw_json=item.raw,
                converted=item.payload if item.kind in {"prompt", "persona", "regex"} else {},
                warnings=item.warnings,
            ))
            created[item.kind] += 1
        db.flush()
        if activate:
            prompt_id = resource_id(plan.source, "prompt", plan.active_prompt_key) if plan.active_prompt_key else None
            prompt = db.get(models.ImportedResource, prompt_id) if prompt_id else None
            if prompt:
                row = db.get(models.GlobalPromptConfig, "default")
                if row is None:
                    db.add(models.GlobalPromptConfig(id="default", prompt_slots=prompt.converted["prompt_slots"], revision=1))
                elif row.prompt_slots != prompt.converted["prompt_slots"]:
                    expected = row.revision if expected_prompt_revision is None else expected_prompt_revision
                    result = db.execute(update(models.GlobalPromptConfig).where(
                        models.GlobalPromptConfig.id == "default", models.GlobalPromptConfig.revision == expected,
                    ).values(prompt_slots=prompt.converted["prompt_slots"], revision=expected + 1, updated_at=models.utc_now()))
                    if result.rowcount != 1:
                        raise ValueError("全局提示词已被其他窗口修改，导入已回滚，请重新预览")
            defaults = db.get(models.DefaultSessionConfig, "default")
            if defaults is None:
                defaults = models.DefaultSessionConfig(id="default")
                db.add(defaults)
            defaults.preset = plan.defaults
            candidate_id = resource_id(plan.source, "profile", plan.active_profile_key) if plan.active_profile_key else None
            defaults.api_profile_id = candidate_id if candidate_id and db.get(models.APIProfile, candidate_id) else None
        db.commit()
    except Exception:
        db.rollback()
        raise
    report.update(created=dict(created), activated=activate)
    return report
