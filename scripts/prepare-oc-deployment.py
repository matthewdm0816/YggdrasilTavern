"""Prepare an uploaded release without changing the existing public listener."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import tarfile


def run(args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--release", required=True)
    args = parser.parse_args()
    if not args.release.isalnum():
        raise ValueError("Invalid release identifier")
    root = Path.home() / "YggdrasilTavern"
    release = root / "releases" / args.release
    shared = root / "shared"
    shared.mkdir(parents=True, exist_ok=True, mode=0o700)
    release.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tarfile.open(root / "yggdrasil-oc.tar.gz", "r:gz") as archive:
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if not member.isfile() or path.is_absolute() or ".." in path.parts:
                raise ValueError("Deployment archive contains an unsafe member")
        archive.extractall(release)
    manifest = json.loads((release / "deployment-manifest.json").read_text())
    if manifest["release"] != args.release:
        raise ValueError("Deployment release identifier does not match its manifest")
    for name, expected in manifest["files"].items():
        if hashlib.sha256((release / name).read_bytes()).hexdigest() != expected:
            raise ValueError(f"Deployment file hash mismatch: {name}")
    database = release / "treechat.db"
    if hashlib.sha256(database.read_bytes()).hexdigest() != manifest["database_sha256"]:
        raise ValueError("Deployment database snapshot hash mismatch")
    uv = Path.home() / ".local/bin/uv"
    if not uv.is_file():
        raise FileNotFoundError("Install the official uv binary before preparing the release")
    run([str(uv), "sync", "--frozen", "--no-dev", "--python", "3.12"], cwd=release)
    shared_db = shared / "treechat.db"
    shared_env = shared / "backend.env"
    if shared_db.exists() or shared_env.exists():
        raise FileExistsError("Shared application data already exists; refusing to overwrite it")
    shutil.move(database, shared_db)
    shutil.move(release / "backend/.env", shared_env)
    shared_db.chmod(0o600)
    shared_env.chmod(0o600)
    env_script = (
        "from dotenv import set_key; import sys; "
        "set_key(sys.argv[1], 'TREECHAT_DATABASE_URL', 'sqlite:///' + sys.argv[2]); "
        "set_key(sys.argv[1], 'TREECHAT_CORS_ORIGINS', 'https://tavern.apeirianetwork.com:15266'); "
        "set_key(sys.argv[1], 'YGGDRASIL_AUTH_COOKIE_SECURE', 'true')"
    )
    python = release / ".venv/bin/python"
    run([str(python), "-c", env_script, str(shared_env), str(shared_db)])
    (release / "backend/.env").symlink_to(shared_env)
    (release / "treechat.db").symlink_to(shared_db)
    current = root / "current"
    if current.exists() or current.is_symlink():
        raise FileExistsError("An active release already exists; refusing an implicit replacement")
    current.symlink_to(release, target_is_directory=True)
    units = Path.home() / ".config/systemd/user"
    units.mkdir(parents=True, exist_ok=True)
    for name in ("yggdrasil-tavern.service", "yggdrasil-gateway.service"):
        target = units / name
        if target.exists():
            raise FileExistsError(f"Service unit already exists: {name}")
        shutil.copyfile(release / "deploy/oc" / name, target)
    # Only the private backend starts here; no Caddy/public/SillyTavern changes.
    run(["systemctl", "--user", "daemon-reload"])
    run(["systemctl", "--user", "enable", "--now", "yggdrasil-tavern.service"])
    print(json.dumps({"release": args.release, "backend": "127.0.0.1:8811", "public_listener_changed": False}))


if __name__ == "__main__":
    main()
