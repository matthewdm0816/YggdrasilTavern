"""Packaging must carry the registry and each referenced user's private database."""

import hashlib
import importlib.util
import json
import sqlite3
import tarfile
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_package_includes_independent_databases_and_registry(tmp_path, monkeypatch):
    root = tmp_path / "checkout"
    root.mkdir()
    settings = Settings(_env_file=None, database_url=f"sqlite:///{(root / 'treechat.db').as_posix()}")
    app = create_app(settings=settings)
    with TestClient(app) as client:
        client.post("/api/characters", json={"name": "Owner private character"})
        assert client.post("/api/auth/setup", json={"username": "owner", "password": "long-test-password"}).status_code == 200
        user = client.post("/api/auth/users", json={"username": "alice", "password": "long-test-password"}).json()
        client.post("/api/auth/users", json={"username": "never-logged-in", "password": "long-test-password"})
        client.post("/api/auth/login", json={"username": "alice", "password": "long-test-password"})
        assert client.post("/api/characters", json={"name": "Alice private character"}).status_code == 200
    for name in ("pyproject.toml", "uv.lock", "backend/alembic.ini", "backend/.env", "frontend/dist/index.html"):
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("test-only fixture", encoding="utf-8")
    for name in ("backend/app", "backend/alembic", "deploy/oc"):
        (root / name).mkdir(parents=True, exist_ok=True)
    source = Path(__file__).resolve().parents[2] / "scripts/package-oc-deployment.py"
    spec = importlib.util.spec_from_file_location("test_deployment_packager", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "ROOT", root)
    monkeypatch.setattr(module, "get_settings", lambda: settings)
    module.main()
    archive_path = next((root / ".yggdrasil-runtime/deploy-oc").glob("*/yggdrasil-oc.tar.gz"))
    with tarfile.open(archive_path) as archive:
        manifest = json.load(archive.extractfile("deployment-manifest.json"))
        assert set(manifest["account_databases"]) == {"treechat.db.users/accounts.db", f"treechat.db.users/{user['id']}.db"}
        for name, digest in manifest["account_databases"].items():
            data = archive.extractfile(name).read()
            assert hashlib.sha256(data).hexdigest() == digest
            path = tmp_path / Path(name).name
            path.write_bytes(data)
            with sqlite3.connect(path) as connection:
                if path.name == "accounts.db":
                    assert connection.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 3
                else:
                    assert connection.execute("SELECT name FROM characters").fetchall() == [("Alice private character",)]
