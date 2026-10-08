"""Package this working checkout and a consistent SQLite snapshot for OC.

The private archive contains backend credentials and is kept under the ignored
runtime directory. Nothing is uploaded or published by this command.
"""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import get_settings
from sqlalchemy.engine import make_url


def main() -> None:
    settings = get_settings()
    if not settings.auth_enabled:
        raise RuntimeError("Deployment requires the existing application authentication to be enabled")
    database_url = make_url(settings.database_url)
    if database_url.get_backend_name() != "sqlite" or not database_url.database:
        raise RuntimeError("This deployment packager currently requires a file-backed SQLite database")
    database_path = Path(database_url.database)
    if not database_path.is_absolute():
        database_path = ROOT / database_path
    if not database_path.is_file():
        raise FileNotFoundError("The configured application database does not exist")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output = ROOT / ".yggdrasil-runtime" / "deploy-oc" / stamp
    output.mkdir(parents=True, exist_ok=False)
    output.chmod(0o700)
    snapshot = output / "treechat.db"
    with sqlite3.connect(database_path.resolve().as_uri() + "?mode=ro", uri=True) as source, sqlite3.connect(snapshot) as target:
        source.backup(target)
    snapshot.chmod(0o600)
    required = ["pyproject.toml", "uv.lock", "backend/alembic.ini", "backend/.env", "frontend/dist/index.html"]
    for name in required:
        if not (ROOT / name).is_file():
            raise FileNotFoundError(f"Required deployment file is missing: {name}")
    files = [ROOT / name for name in required if name != "frontend/dist/index.html"]
    for directory in ("backend/app", "backend/alembic", "frontend/dist", "deploy/oc"):
        files.extend(sorted(path for path in (ROOT / directory).rglob("*") if path.is_file() and "__pycache__" not in path.parts))
    manifest = {
        "release": stamp,
        "files": {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
        "database_sha256": hashlib.sha256(snapshot.read_bytes()).hexdigest(),
    }
    manifest_path = output / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    archive_path = output / "yggdrasil-oc.tar.gz"
    with tarfile.open(archive_path, "w:gz") as archive:
        for path in files:
            info = archive.gettarinfo(str(path), arcname=path.relative_to(ROOT).as_posix())
            info.mode = 0o600 if path.name == ".env" else 0o644
            with path.open("rb") as stream:
                archive.addfile(info, stream)
        archive.add(snapshot, arcname="treechat.db")
        archive.add(manifest_path, arcname="deployment-manifest.json")
    archive_path.chmod(0o600)
    # Never print the environment file or SQL contents.
    print(json.dumps({"release": stamp, "archive": str(archive_path), "size": archive_path.stat().st_size, "files": len(files)}))


if __name__ == "__main__":
    main()
