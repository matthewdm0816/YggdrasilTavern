"""Model calls. Every call is a single system + user turn with no tools.

The planner/analyst roles may ask for JSON; the writer role never does. Every
request and response is logged under <project>/logs so the exact context the
writer saw can be audited afterwards.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime
from typing import Callable, TypeVar

from pydantic import BaseModel, ValidationError

from .project import HarnessError, Project, ProviderConfig, Role, RoleConfig, dump_yaml

M = TypeVar("M", bound=BaseModel)
OnText = Callable[[str], None]


def _api_key(provider: ProviderConfig) -> str:
    key = os.environ.get(provider.api_key_env, "").strip()
    if not key:
        raise HarnessError(f"环境变量 {provider.api_key_env} 未设置。请在 lightnovel-harness/.env 中填写。")
    return key


def _headers(provider: ProviderConfig, session_id: str) -> dict[str, str]:
    return {provider.session_header: session_id} if provider.session_header else {}


def _call_openai_chat(provider, role_cfg, session_id, system, user, json_mode, on_text):
    import openai

    client = openai.OpenAI(
        api_key=_api_key(provider),
        base_url=provider.base_url,
        default_headers=_headers(provider, session_id),
        timeout=900,
    )
    extra = {"response_format": {"type": "json_object"}} if json_mode else {}
    stream = client.chat.completions.create(
        model=role_cfg.model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        stream=True,
        stream_options={"include_usage": True},
        **role_cfg.params,
        **extra,
    )
    parts, usage, finish = [], None, None
    for chunk in stream:
        if chunk.usage:
            usage = chunk.usage.model_dump(mode="json")
        if not chunk.choices:
            continue
        choice = chunk.choices[0]
        if choice.delta.content:
            parts.append(choice.delta.content)
            on_text(choice.delta.content)
        if choice.finish_reason:
            finish = choice.finish_reason
    if finish != "stop":
        raise HarnessError(f"{role_cfg.model} 没有正常结束（finish_reason={finish}）。若为 length，请在 project.yaml 中调高 max_tokens。")
    return "".join(parts), usage


def _call_google_genai(provider, role_cfg, session_id, system, user, json_mode, on_text):
    from google import genai
    from google.genai import types

    client = genai.Client(
        api_key=_api_key(provider),
        http_options=types.HttpOptions(
            base_url=provider.base_url,
            api_version="v1beta",
            headers=_headers(provider, session_id),
            timeout=900_000,
        ),
    )
    config = types.GenerateContentConfig(
        system_instruction=system,
        response_mime_type="application/json" if json_mode else None,
        **role_cfg.params,
    )
    parts, last = [], None
    for chunk in client.models.generate_content_stream(model=role_cfg.model, contents=user, config=config):
        last = chunk
        if chunk.text:
            parts.append(chunk.text)
            on_text(chunk.text)
    if last is None or not last.candidates:
        feedback = last.prompt_feedback if last is not None else None
        raise HarnessError(f"{role_cfg.model} 没有返回任何候选（prompt_feedback={feedback}）。")
    finish = last.candidates[0].finish_reason
    if finish != types.FinishReason.STOP:
        raise HarnessError(f"{role_cfg.model} 没有正常结束（finish_reason={finish}）。若为 MAX_TOKENS，请在 project.yaml 中调高 max_output_tokens。")
    usage = last.usage_metadata.model_dump(mode="json", exclude_none=True) if last.usage_metadata else None
    return "".join(parts), usage


_PROTOCOLS = {"openai_chat": _call_openai_chat, "google_genai": _call_google_genai}


def _call_provider(provider: ProviderConfig, role_cfg: RoleConfig, session_id: str, system: str, user: str,
                   json_mode: bool, on_text: OnText) -> tuple[str, dict | None]:
    return _PROTOCOLS[provider.protocol](provider, role_cfg, session_id, system, user, json_mode, on_text)


class _Progress:
    """Shows a live character count on stderr for calls that are not streamed to the terminal."""

    def __init__(self, label: str):
        self.label, self.count = label, 0

    def __call__(self, text: str) -> None:
        self.count += len(text)
        sys.stderr.write(f"\r  {self.label} 生成中… {self.count} 字")
        sys.stderr.flush()

    def done(self) -> None:
        if self.count:
            sys.stderr.write("\n")


def complete(project: Project, role: Role, stage: str, system: str, user: str, *,
             json_mode: bool = False, on_text: OnText | None = None) -> str:
    role_cfg = project.config.roles[role]
    if role_cfg.provider not in project.config.providers:
        raise HarnessError(f"project.yaml 中角色 {role} 引用了不存在的 provider：{role_cfg.provider}")
    provider = project.config.providers[role_cfg.provider]
    progress = _Progress(f"[{role}:{role_cfg.model}] {stage}") if on_text is None and sys.stderr.isatty() else None
    started = time.monotonic()
    record = {"role": role, "stage": stage, "model": role_cfg.model, "params": role_cfg.params,
              "json_mode": json_mode, "system": system, "user": user}
    try:
        text, usage = _call_provider(provider, role_cfg, project.config.session_id, system, user,
                                     json_mode, on_text or progress or (lambda _: None))
        record.update(output=text, usage=usage)
        return text
    except Exception as exc:
        record["error"] = f"{type(exc).__name__}: {exc}"
        raise
    finally:
        if progress:
            progress.done()
        record["seconds"] = round(time.monotonic() - started, 1)
        _write_log(project, record)


def _write_log(project: Project, record: dict) -> None:
    project.log_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    path = project.log_dir / f"{stamp}-{record['role']}-{record['stage']}.yaml"
    path.write_text(dump_yaml(record), encoding="utf-8")


_FENCE = re.compile(r"^\s*```(?:json)?\s*\n(.*?)\n\s*```\s*$", re.S)


def parse_json_model(text: str, model: type[M]) -> M:
    match = _FENCE.match(text)
    return model.model_validate(json.loads(match.group(1) if match else text))


def complete_json(project: Project, role: Role, stage: str, system: str, user: str, model: type[M],
                  *, retries: int = 2) -> M:
    schema = json.dumps(model.model_json_schema(), ensure_ascii=False)
    request = (f"{user}\n\n# 输出格式\n只输出一个符合下面 JSON Schema 的 JSON 对象。"
               f"不要使用 Markdown 代码块，不要输出任何其他文字。\n{schema}")
    text = complete(project, role, stage, system, request, json_mode=True)
    attempt = 0
    while True:
        try:
            return parse_json_model(text, model)
        except (json.JSONDecodeError, ValidationError) as exc:
            if attempt == retries:
                raise HarnessError(
                    f"{stage} 的输出在 {retries} 次修复后仍不合法：\n{exc}\n完整输入输出见 {project.log_dir}"
                ) from exc
            attempt += 1
            repair = (f"{request}\n\n# 你上一次的输出\n{text}\n\n# 校验错误\n{exc}\n\n"
                      "请修正这些错误，重新输出完整的 JSON 对象。")
            text = complete(project, role, f"{stage}-repair{attempt}", system, repair, json_mode=True)
