"""Novel project layout, configuration and YAML persistence."""

from __future__ import annotations

import json
import re
import shutil
import uuid
from pathlib import Path
from typing import Literal, TypeVar

import yaml
from pydantic import BaseModel, Field, ValidationError

from .schema import Bible, ChapterPlan, Ledger, Model, SceneRecord, VolumeOutline

TEMPLATE_DIR = Path(__file__).parent / "templates" / "project"
Role = Literal["planner", "writer", "analyst"]


class HarnessError(RuntimeError):
    """A user-facing failure with an actionable message."""


class ProviderConfig(Model):
    protocol: Literal["openai_chat", "google_genai"]
    base_url: str
    api_key_env: str
    session_header: str | None = None


class RoleConfig(Model):
    provider: str
    model: str
    params: dict = Field(default_factory=dict)


class Targets(Model):
    chapters_per_volume: int = 10
    scene_chars: int = 3000
    scene_separator: str = "◇"


class LintConfig(Model):
    banned: list[str] = Field(default_factory=list)
    watch: list[str] = Field(default_factory=list)


class ProjectConfig(Model):
    title: str
    session_id: str
    providers: dict[str, ProviderConfig]
    roles: dict[Role, RoleConfig]
    targets: Targets = Field(default_factory=Targets)
    lint: LintConfig = Field(default_factory=LintConfig)


def _str_presenter(dumper: yaml.SafeDumper, data: str):
    style = "|" if "\n" in data else None
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)


class _Dumper(yaml.SafeDumper):
    pass


_Dumper.add_representer(str, _str_presenter)

M = TypeVar("M", bound=BaseModel)


def dump_yaml(data) -> str:
    return yaml.dump(data, Dumper=_Dumper, allow_unicode=True, sort_keys=False, width=1000)


def load_model(path: Path, model: type[M], missing_hint: str) -> M:
    if not path.exists():
        raise HarnessError(f"找不到 {path}。{missing_hint}")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        return model.model_validate(data)
    except (yaml.YAMLError, ValidationError) as exc:
        raise HarnessError(f"{path} 格式错误：\n{exc}") from exc


def save_model(path: Path, obj: BaseModel) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_yaml(obj.model_dump(mode="json")), encoding="utf-8")


def _strip_comments(markdown: str) -> str:
    without = re.sub(r"<!--.*?-->", "", markdown, flags=re.S)
    return re.sub(r"\n{3,}", "\n\n", without).strip()


class Project:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.config = load_model(
            self.root / "project.yaml", ProjectConfig, "请先用 `lnh init <目录>` 创建小说项目，或用 -p 指定项目目录。"
        )

    # ---- paths
    @property
    def premise_path(self) -> Path:
        return self.root / "premise.md"

    @property
    def style_path(self) -> Path:
        return self.root / "style.md"

    @property
    def bible_path(self) -> Path:
        return self.root / "bible.yaml"

    @property
    def ledger_path(self) -> Path:
        return self.root / "state" / "ledger.yaml"

    @property
    def log_dir(self) -> Path:
        return self.root / "logs"

    def volume_path(self, v: int) -> Path:
        return self.root / "plan" / f"vol{v:02d}.yaml"

    def chapter_path(self, v: int, c: int) -> Path:
        return self.root / "plan" / f"vol{v:02d}" / f"ch{c:02d}.yaml"

    def scene_draft_path(self, v: int, c: int, s: int) -> Path:
        return self.root / "draft" / f"vol{v:02d}" / f"ch{c:02d}" / f"s{s:02d}.md"

    def chapter_draft_path(self, v: int, c: int) -> Path:
        return self.root / "draft" / f"vol{v:02d}" / f"ch{c:02d}.md"

    # ---- loaders
    def read_text(self, path: Path, hint: str) -> str:
        if not path.exists():
            raise HarnessError(f"找不到 {path}。{hint}")
        return path.read_text(encoding="utf-8")

    def premise(self) -> str:
        return _strip_comments(self.read_text(self.premise_path, "请先写好企划书 premise.md。"))

    def style(self) -> str:
        # style.md goes verbatim into the writer's system prompt, so author notes must not.
        return _strip_comments(self.read_text(self.style_path, "请先写好文风指南 style.md。"))

    def bible(self) -> Bible:
        return load_model(self.bible_path, Bible, "请先运行 `lnh plan bible`。")

    def volume(self, v: int) -> VolumeOutline:
        return load_model(self.volume_path(v), VolumeOutline, f"请先运行 `lnh plan volume {v}`。")

    def chapter(self, v: int, c: int) -> ChapterPlan:
        return load_model(self.chapter_path(v, c), ChapterPlan, f"请先运行 `lnh plan chapter {v} {c}`。")

    def ledger(self) -> Ledger:
        if not self.ledger_path.exists():
            return Ledger()
        return load_model(self.ledger_path, Ledger, "")

    def scene_draft(self, v: int, c: int, s: int) -> str:
        return self.read_text(self.scene_draft_path(v, c, s), f"请先运行 `lnh draft {v} {c} {s}`。")

    def planned_chapters(self) -> list[tuple[int, int]]:
        """(volume, chapter) pairs that have a chapter plan on disk, in story order."""
        paths = (self.root / "plan").glob("vol*/ch*.yaml")
        return sorted((int(p.parent.name[3:]), int(p.stem[2:])) for p in paths)

    def record_scene(self, record: SceneRecord) -> None:
        ledger = self.ledger()
        ledger.scenes = [
            r for r in ledger.scenes if (r.volume, r.chapter, r.scene) != (record.volume, record.chapter, record.scene)
        ]
        ledger.scenes.append(record)
        ledger.scenes.sort(key=lambda r: (r.volume, r.chapter, r.scene))
        save_model(self.ledger_path, ledger)


def init_project(root: Path, title: str) -> Path:
    if root.exists() and any(root.iterdir()):
        raise HarnessError(f"{root} 已存在且不为空，不会覆盖。")
    shutil.copytree(TEMPLATE_DIR, root, dirs_exist_ok=True)
    config_path = root / "project.yaml"
    text = config_path.read_text(encoding="utf-8")
    # A JSON string literal is also a valid YAML scalar, so any title is safe here.
    text = text.replace("__TITLE__", json.dumps(title, ensure_ascii=False))
    text = text.replace("__SESSION_ID__", f"lnh-{uuid.uuid4()}")
    config_path.write_text(text, encoding="utf-8")
    return root
