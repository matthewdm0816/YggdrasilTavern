"""Read a bounded configuration snapshot locally or over the user's SSH alias.

No remote writes, shell interpolation of paths, or extraction of untrusted tar
members. SSH stdout contains secrets and is never included in diagnostics.
"""

from __future__ import annotations

import io
import json
from pathlib import Path, PurePosixPath
import re
import shlex
import subprocess
import tarfile
import tempfile

MAX_TOTAL = 128 * 1024 * 1024
MAX_FILE = 32 * 1024 * 1024
CONFIG_DIRS = (
    "characters", "worlds", "OpenAI Settings", "TextGen Settings",
    "KoboldAI Settings", "NovelAI Settings", "context", "instruct",
    "sysprompt", "reasoning", "QuickReplies", "themes", "movingUI",
    "groups", "User Avatars",
)
ROOT_FILES = ("settings.json", "secrets.json")

# This same reader runs on the SSH host with only the Python standard library.
REMOTE_READER = '''
import io,json,sys,tarfile
from pathlib import Path
root=Path(sys.argv[1]).expanduser().resolve()
user=sys.argv[2]
dirs=json.loads(sys.argv[3])
candidates=[root/'data'/user,root/user,root]
root=next((p for p in candidates if (p/'settings.json').is_file()),None)
if root is None: raise RuntimeError('No settings.json found in the selected user directory')
files=[]; total=0; omitted={}; links=[]
for name in ['settings.json','secrets.json']+dirs:
 p=root/name
 if p.is_symlink(): links.append(name); continue
 if p.is_file(): files.append(p)
 elif p.is_dir():
  for f in sorted(p.rglob('*')):
   if f.is_symlink() or not f.resolve().is_relative_to(root.resolve()):
    links.append(f.relative_to(root).as_posix()); continue
   if f.is_file(): files.append(f)
for p in files:
 size=p.stat().st_size
 if size>33554432: raise RuntimeError('Configuration file exceeds the 32 MiB limit')
 total+=size
if total>134217728 or len(files)>20000: raise RuntimeError('Configuration snapshot exceeds the size or file count limit')
for p in root.iterdir():
 if p.name not in dirs and p.name not in ['settings.json','secrets.json']:
  if p.is_symlink(): omitted[p.name]='symbolic link'
  elif p.is_dir(): omitted[p.name]=sum(1 for f in p.rglob('*') if f.is_file())
  else: omitted[p.name]=1
manifest=json.dumps({'directory':str(root),'omitted':omitted,'links':links}).encode()
with tarfile.open(fileobj=sys.stdout.buffer,mode='w|gz') as archive:
 info=tarfile.TarInfo('_yggdrasil_manifest.json');info.size=len(manifest)
 archive.addfile(info,io.BytesIO(manifest))
 for p in files:
  archive.add(p,arcname=p.relative_to(root).as_posix(),recursive=False)
'''


def validate_source(ssh_host: str | None, directory: str, user: str) -> None:
    if ssh_host and (not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.@-]*", ssh_host)):
        raise ValueError("SSH 主机请填写 ~/.ssh/config 中的别名，或 user@hostname")
    if not re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", user) or user in {".", ".."}:
        raise ValueError("SillyTavern 用户目录名称无效")
    if not directory.strip() or "\x00" in directory or "\n" in directory:
        raise ValueError("SillyTavern 目录不能为空或包含控制字符")


def read_source(
    directory: str, *, ssh_host: str | None = None, user: str = "default-user",
) -> tuple[dict[str, bytes], dict, str]:
    validate_source(ssh_host, directory, user)
    if not ssh_host:
        root = Path(directory).expanduser().resolve()
        candidates = (root / "data" / user, root / user, root)
        root = next((p for p in candidates if (p / "settings.json").is_file()), None)
        if root is None:
            raise ValueError("所选目录及用户目录中没有 settings.json")
        files: dict[str, bytes] = {}
        links: list[str] = []
        for name in (*ROOT_FILES, *CONFIG_DIRS):
            path = root / name
            if path.is_symlink():
                links.append(name)
                continue
            paths = [path] if path.is_file() else sorted(path.rglob("*")) if path.is_dir() else []
            for file in paths:
                relative = file.relative_to(root).as_posix()
                if file.is_symlink() or not file.resolve().is_relative_to(root):
                    links.append(relative)
                    continue
                if file.is_file():
                    if file.stat().st_size > MAX_FILE:
                        raise ValueError(f"配置文件超过 32 MiB：{relative}")
                    files[relative] = file.read_bytes()
                    if sum(map(len, files.values())) > MAX_TOTAL or len(files) > 20000:
                        raise ValueError("配置总大小超过 128 MiB 或文件数量超过 20000")
        omitted = {}
        for path in root.iterdir():
            if path.name not in (*ROOT_FILES, *CONFIG_DIRS):
                omitted[path.name] = "symbolic link" if path.is_symlink() else (
                    sum(1 for file in path.rglob("*") if file.is_file()) if path.is_dir() else 1
                )
        return files, {"directory": str(root), "omitted": omitted, "links": links}, f"local:{root}"

    command = "python3 -c " + shlex.quote(REMOTE_READER) + " " + " ".join(
        shlex.quote(arg) for arg in (directory, user, json.dumps(CONFIG_DIRS))
    )
    with tempfile.TemporaryFile() as output:
        try:
            result = subprocess.run(
                ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", ssh_host, command],
                stdout=output, stderr=subprocess.PIPE, timeout=120, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ValueError("SSH 读取超过 120 秒，请检查远端主机和目录") from exc
        except OSError as exc:
            raise ValueError("无法启动 SSH，请确认本机已安装 OpenSSH") from exc
        if result.returncode:
            # Only SSH/reader stderr, never stdout, is diagnostic output.
            detail = result.stderr.decode("utf-8", errors="replace")[-1600:]
            raise ValueError(f"SSH 读取失败（退出码 {result.returncode}）：{detail}")
        if output.tell() > MAX_TOTAL:
            raise ValueError("SSH 快照超过 128 MiB")
        output.seek(0)
        files = {}
        total = 0
        try:
            with tarfile.open(fileobj=output, mode="r:gz") as archive:
                for member in archive:
                    path = PurePosixPath(member.name)
                    if not member.isfile() or path.is_absolute() or ".." in path.parts or "\\" in member.name:
                        raise ValueError("SSH 快照包含不安全的文件路径或链接")
                    total += member.size
                    if member.size > MAX_FILE or total > MAX_TOTAL or len(files) >= 20000:
                        raise ValueError("SSH 快照解压后超过大小或文件数量限制")
                    if member.name in files:
                        raise ValueError("SSH 快照包含重复文件路径")
                    stream = archive.extractfile(member)
                    if stream is None:
                        raise ValueError("SSH 快照文件无法读取")
                    files[member.name] = stream.read()
        except (tarfile.TarError, EOFError, OSError) as exc:
            raise ValueError("SSH 返回的配置快照损坏或不完整") from exc
    manifest = json.loads(files.pop("_yggdrasil_manifest.json"))
    return files, manifest, f"ssh:{ssh_host}:{manifest['directory']}"
