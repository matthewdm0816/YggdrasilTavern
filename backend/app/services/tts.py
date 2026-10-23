"""Per-user speech settings and bounded MiniMax/OpenAI-compatible requests."""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models, schemas
from .errors import ApplicationError
from .provider_protocols.transport import safe_endpoint, safe_error_text
from .macros import expand_message_content
from .tts_text import extract_tts_text


SETTINGS_ID = "default"
MAX_AUDIO_BYTES = 25 * 1024 * 1024
MAX_JSON_BYTES = MAX_AUDIO_BYTES * 2 + 1024 * 1024
MAX_VOICES_BYTES = 4 * 1024 * 1024
REQUEST_DEADLINE_SECONDS = 180


class TtsSettingsConflict(ValueError):
    pass


def settings_state(db: Session) -> schemas.TtsSettingsOut:
    row = db.get(models.TtsSettings, SETTINGS_ID)
    if row is None:
        return schemas.TtsSettingsOut()
    return schemas.TtsSettingsOut.model_validate(row)


def validate_endpoint(endpoint: str, *, allow_empty: bool = False) -> str:
    value = endpoint.strip()
    if not value and allow_empty:
        return value
    try:
        parts = urlsplit(value)
        port = parts.port
        if (
            parts.scheme not in {"http", "https"}
            or not parts.hostname
            or parts.username is not None
            or parts.password is not None
            or parts.query
            or parts.fragment
            or "?" in value
            or "#" in value
            or "\\" in value
            or any(character.isspace() or ord(character) < 32 for character in value)
            or (port is not None and not 1 <= port <= 65535)
        ):
            raise ValueError
        parsed = httpx.URL(value)
        if not parsed.host:
            raise ValueError
    except (ValueError, httpx.InvalidURL) as exc:
        raise ValueError("TTS 请求地址须为完整的 HTTP 或 HTTPS 地址，且不能包含账号、密码、查询参数或片段") from exc
    return str(parsed)


def save_settings(db: Session, payload: schemas.TtsSettingsUpdate) -> models.TtsSettings:
    row = db.get(models.TtsSettings, SETTINGS_ID)
    if payload.expected_revision != (row.revision if row is not None else 0):
        raise TtsSettingsConflict("语音设置已被其他窗口修改，请重新加载后保存")
    values = payload.model_dump(exclude={"expected_revision", "api_key", "clear_api_key"})
    values["endpoint"] = validate_endpoint(payload.endpoint, allow_empty=not payload.enabled)
    for field in ("model", "voice", "emotion", "language_boost"):
        values[field] = values[field].strip()
    incoming_key = (payload.api_key or "").strip()
    if incoming_key and any(ord(character) < 33 or ord(character) > 126 for character in incoming_key):
        raise ValueError("API Key 只能包含 ASCII 可见字符，不能包含空格或控制字符")
    if incoming_key and payload.clear_api_key:
        raise ValueError("不能同时填写新 API Key 并选择清除 API Key")
    previous_key = row.api_key if row is not None else None
    if row is not None and previous_key and (
        row.endpoint != values["endpoint"] or row.provider != values["provider"]
    ) and not (incoming_key or payload.clear_api_key):
        raise ValueError("更改 TTS 服务商或请求地址时，请重新填写 API Key 或明确清除已保存的 API Key")
    values["api_key"] = None if payload.clear_api_key else (incoming_key or previous_key)
    if payload.enabled:
        validate_connection(models.TtsSettings(**values), for_speech=True)
    if row is None:
        row = models.TtsSettings(id=SETTINGS_ID, revision=1, **values)
        db.add(row)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise TtsSettingsConflict("语音设置已被其他窗口创建，请重新加载后保存") from exc
        db.refresh(row)
        return row
    result = db.execute(
        update(models.TtsSettings)
        .where(models.TtsSettings.id == SETTINGS_ID, models.TtsSettings.revision == payload.expected_revision)
        .values(**values, revision=payload.expected_revision + 1, updated_at=models.utc_now())
    )
    if result.rowcount != 1:
        db.rollback()
        raise TtsSettingsConflict("语音设置已被其他窗口修改，请重新加载后保存")
    db.commit()
    db.refresh(row)
    return row


def validate_connection(settings: models.TtsSettings, *, for_speech: bool) -> None:
    validate_endpoint(settings.endpoint)
    if settings.provider not in {"minimax", "openai_compatible"}:
        raise ValueError("未识别的 TTS 服务商类型，请重新保存语音设置")
    if settings.provider == "minimax" and not (settings.api_key or "").strip():
        raise ValueError("请先在语音设置中填写 MiniMax API Key")
    if for_speech:
        if not settings.model.strip():
            raise ValueError("请先在语音设置中填写 TTS 模型名称")
        if not settings.voice.strip():
            raise ValueError("请先在语音设置中填写或选择音色")
        if settings.provider == "minimax" and not 0.5 <= settings.speed <= 2.0:
            raise ValueError("MiniMax 语速必须在 0.5 至 2.0 之间")


def max_characters(provider: str) -> int:
    # MiniMax documents a strict < 10000 limit; OpenAI accepts <= 4096.
    return 9999 if provider == "minimax" else 4096


def read_message(db: Session, message_id: str) -> models.Message:
    message = db.get(models.Message, message_id)
    if message is None:
        raise ApplicationError(404, "消息不存在")
    if message.role != "assistant":
        raise ApplicationError(422, "语音朗读仅支持角色消息")
    if message.status != "complete":
        raise ApplicationError(409, "请等待角色消息生成完成后再朗读")
    return message


def preview_message(db: Session, message_id: str, mode: str | None = None) -> schemas.TtsPreviewOut:
    message = read_message(db, message_id)
    settings = settings_state(db)
    extracted = extract_tts_text(expand_message_content(message.session, message.content), mode or settings.text_mode)
    warnings = list(extracted.warnings)
    limit = max_characters(settings.provider)
    if len(extracted.text) > limit:
        warnings.append(f"提取文本共 {len(extracted.text)} 个字符，超过当前服务单次 {limit} 个字符的上限，请缩短后再生成语音")
    return schemas.TtsPreviewOut(
        message_id=message.id, text=extracted.text, segments=extracted.segments,
        warnings=warnings, max_characters=limit,
    )


def _headers(settings: models.TtsSettings) -> dict[str, str]:
    headers = {"Content-Type": "application/json", "Accept": "application/json" if settings.provider == "minimax" else "audio/mpeg"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    return headers


def _upstream_error(message: str, *, url: str, headers: dict[str, str], status: int = 502) -> ApplicationError:
    return ApplicationError(status, safe_error_text(f"{message}\n请求地址：{safe_endpoint(url)}", headers))


async def _post(*, url: str, headers: dict[str, str], payload: dict[str, Any], max_bytes: int) -> tuple[bytes, str]:
    """Buffer a bounded response; no redirects can forward a saved credential."""
    timeout = httpx.Timeout(connect=15, read=90, write=30, pool=15)
    try:
        async with asyncio.timeout(REQUEST_DEADLINE_SECONDS):
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if 300 <= response.status_code < 400:
                        raise _upstream_error("TTS 服务返回重定向，请在语音设置中填写最终接口地址", url=url, headers=headers)
                    successful = 200 <= response.status_code < 300
                    limit = max_bytes if successful else 16 * 1024
                    parts: list[bytes] = []
                    received = 0
                    async for chunk in response.aiter_bytes():
                        received += len(chunk)
                        if received > limit:
                            if successful:
                                raise _upstream_error(f"TTS 服务响应超过 {max_bytes // (1024 * 1024)} MiB 上限，已停止读取", url=url, headers=headers)
                            parts.append(chunk[: max(0, limit - (received - len(chunk)))])
                            break
                        parts.append(chunk)
                    content = b"".join(parts)
                    if not successful:
                        reason = content.decode("utf-8", errors="replace").strip()
                        raise _upstream_error(
                            f"TTS 服务请求失败（HTTP {response.status_code}）：{reason or '服务商未提供具体错误原因'}",
                            url=url, headers=headers,
                        )
                    return content, response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    except (httpx.TimeoutException, TimeoutError) as exc:
        raise _upstream_error("TTS 服务请求超时，请稍后重试或检查服务地址", url=url, headers=headers, status=504) from exc
    except httpx.RequestError as exc:
        raise _upstream_error(f"无法连接 TTS 服务：{type(exc).__name__}：{exc}", url=url, headers=headers) from exc


def _minimax_response(content: bytes, *, url: str, headers: dict[str, str]) -> dict[str, Any]:
    try:
        data = json.loads(content)
    except (ValueError, UnicodeDecodeError) as exc:
        raise _upstream_error("MiniMax 返回了无法解析的 JSON 数据，请检查接口地址", url=url, headers=headers) from exc
    if not isinstance(data, dict):
        raise _upstream_error("MiniMax 响应须为 JSON 对象", url=url, headers=headers)
    base = data.get("base_resp")
    if not isinstance(base, dict) or type(base.get("status_code")) is not int:
        raise _upstream_error("MiniMax 响应缺少有效的 base_resp.status_code", url=url, headers=headers)
    if base["status_code"] != 0:
        trace = data.get("trace_id")
        reason = f"MiniMax 请求失败（错误码 {base['status_code']}）：{base.get('status_msg') or '服务商未提供具体错误原因'}"
        if trace:
            reason += f"\n请求编号：{trace}"
        raise _upstream_error(reason, url=url, headers=headers)
    return data


async def synthesize(settings: models.TtsSettings, text: str) -> bytes:
    validate_connection(settings, for_speech=True)
    text = text.strip()
    if not text:
        raise ValueError("没有可朗读的文字，请检查提取模式或编辑预览文本")
    limit = max_characters(settings.provider)
    if len(text) > limit:
        raise ValueError(f"朗读文本共 {len(text)} 个字符，超过当前服务单次 {limit} 个字符的上限，请缩短文本")
    headers = _headers(settings)
    url = settings.endpoint
    if settings.provider == "minimax":
        voice: dict[str, Any] = {"voice_id": settings.voice, "speed": settings.speed, "vol": settings.volume, "pitch": settings.pitch}
        if settings.emotion:
            voice["emotion"] = settings.emotion
        payload = {
            "model": settings.model, "text": text, "stream": False, "output_format": "hex",
            "voice_setting": voice,
            "audio_setting": {"format": "mp3", "sample_rate": 32000, "bitrate": 128000, "channel": 1},
        }
        if settings.language_boost:
            payload["language_boost"] = settings.language_boost
        content, _ = await _post(url=url, headers=headers, payload=payload, max_bytes=MAX_JSON_BYTES)
        response = _minimax_response(content, url=url, headers=headers)
        data = response.get("data")
        if not isinstance(data, dict) or data.get("status") != 2:
            raise _upstream_error("MiniMax 未返回已完成的音频（data.status 应为 2）", url=url, headers=headers)
        encoded = data.get("audio")
        if not isinstance(encoded, str) or not encoded:
            raise _upstream_error("MiniMax 返回的音频为空或缺少 data.audio", url=url, headers=headers)
        if len(encoded) > MAX_AUDIO_BYTES * 2:
            raise _upstream_error("MiniMax 音频超过 25 MiB 上限", url=url, headers=headers)
        try:
            audio = bytes.fromhex(encoded)
        except ValueError as exc:
            raise _upstream_error("MiniMax 返回的 data.audio 不是有效的十六进制音频", url=url, headers=headers) from exc
    else:
        payload = {"model": settings.model, "input": text, "voice": settings.voice, "speed": settings.speed, "response_format": "mp3"}
        audio, content_type = await _post(url=url, headers=headers, payload=payload, max_bytes=MAX_AUDIO_BYTES)
        if content_type not in {"audio/mpeg", "audio/mp3", "audio/x-mp3", "application/octet-stream"}:
            reason = ""
            if "json" in content_type or content_type.startswith("text/"):
                reason = f"：{audio[:2000].decode('utf-8', errors='replace')}"
            raise _upstream_error(f"TTS 服务未返回 MP3 音频（Content-Type: {content_type or '缺失'}）{reason}", url=url, headers=headers)
    if not audio:
        raise _upstream_error("TTS 服务返回的音频为空", url=url, headers=headers)
    if not (audio.startswith(b"ID3") or (len(audio) >= 2 and audio[0] == 0xFF and audio[1] & 0xE0 == 0xE0)):
        raise _upstream_error("TTS 服务返回的数据没有有效的 MP3 文件头", url=url, headers=headers)
    return audio


async def list_voices(settings: models.TtsSettings) -> list[schemas.TtsVoiceOut]:
    if settings.provider != "minimax":
        raise ValueError("当前仅 MiniMax 支持在此获取音色列表；OpenAI 兼容服务请手动填写音色")
    validate_connection(settings, for_speech=False)
    parts = urlsplit(settings.endpoint)
    path = parts.path.rstrip("/").rsplit("/", 1)[0] + "/get_voice"
    url = urlunsplit((parts.scheme, parts.netloc, path, "", ""))
    headers = _headers(settings)
    content, _ = await _post(url=url, headers=headers, payload={"voice_type": "all"}, max_bytes=MAX_VOICES_BYTES)
    response = _minimax_response(content, url=url, headers=headers)
    voices: list[schemas.TtsVoiceOut] = []
    for key, kind in (("system_voice", "system"), ("voice_cloning", "cloned"), ("voice_generation", "generated")):
        items = response.get(key, [])
        if items is None:
            items = []
        if not isinstance(items, list):
            raise _upstream_error(f"MiniMax 音色列表 {key} 不是数组", url=url, headers=headers)
        for item in items:
            if not isinstance(item, dict) or not isinstance(item.get("voice_id"), str) or not item["voice_id"].strip():
                raise _upstream_error(f"MiniMax 音色列表 {key} 包含无效的 voice_id", url=url, headers=headers)
            description = item.get("description") or ""
            if isinstance(description, list):
                description = "、".join(str(value) for value in description)
            voices.append(schemas.TtsVoiceOut(
                id=item["voice_id"], name=str(item.get("voice_name") or item["voice_id"]),
                description=str(description), kind=kind,
            ))
    return voices
