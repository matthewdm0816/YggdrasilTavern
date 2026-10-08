"""Switch OC's existing 8802 listener, restoring SillyTavern on failure."""

import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import ssl
import subprocess
import time

ROOT = Path.home() / "YggdrasilTavern"
SHARED = ROOT / "shared"
ST_ROOT = Path.home() / "SillyTavern"


def run(*args):
    subprocess.run(args, check=True)


def wait_port(port, expected_open=True):
    for _ in range(60):
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                opened = True
        except OSError:
            opened = False
        if opened == expected_open:
            return
        time.sleep(0.25)
    raise RuntimeError(f"Port {port} did not reach its expected state")


def https_status(host, port, path="/"):
    with socket.create_connection(("127.0.0.1", port), timeout=5) as raw:
        with ssl._create_unverified_context().wrap_socket(raw, server_hostname=host) as stream:
            request = f"GET {path} HTTP/1.1\r\nHost: {host}:15266\r\nConnection: close\r\n\r\n"
            stream.sendall(request.encode())
            return int(stream.recv(4096).split(b"\r\n", 1)[0].split()[1])


def main():
    managed_pid = subprocess.check_output(
        ["systemctl", "--user", "show", "sillytavern-upstream.service", "-p", "MainPID", "--value"], text=True,
    ).strip()
    old_pid = int(managed_pid or "0") or 8091
    process = Path("/proc") / str(old_pid)
    if process.stat().st_uid != os.getuid() or Path(os.readlink(process / "cwd")) != ST_ROOT:
        raise RuntimeError("The expected existing SillyTavern process identity has changed")
    args = process.joinpath("cmdline").read_bytes().split(b"\0")
    if b"server.js" not in args or b"8802" not in args:
        raise RuntimeError("The existing process is not the expected SillyTavern listener")
    gateway_env = SHARED / "gateway.env"
    original_gateway = gateway_env.read_text()
    (SHARED / "gateway.env.before-public").write_text(original_gateway)
    runtime = dict(item.split(b"=", 1) for item in process.joinpath("environ").read_bytes().split(b"\0") if b"=" in item)
    node_path = runtime[b"PATH"].decode()
    (SHARED / "sillytavern-runtime.env").write_text("PATH=" + json.dumps(node_path) + "\n")
    (SHARED / "sillytavern-runtime.env").chmod(0o600)
    unit = Path.home() / ".config/systemd/user/sillytavern-upstream.service"
    original_unit = unit.read_text()
    (SHARED / "sillytavern-upstream.service.before-public").write_text(original_unit)
    expected_cert = hashlib.sha256(ssl.PEM_cert_to_DER_cert((ST_ROOT / "certs/cert.pem").read_text())).hexdigest()
    run("systemd-analyze", "--user", "verify", str(unit))
    run("systemctl", "--user", "daemon-reload")
    switched = False
    try:
        os.kill(old_pid, signal.SIGTERM)
        switched = True
        wait_port(8802, expected_open=False)
        run("systemctl", "--user", "start", "sillytavern-upstream.service")
        wait_port(8815)
        with socket.create_connection(("127.0.0.1", 8815), timeout=5) as raw:
            with ssl._create_unverified_context().wrap_socket(raw, server_hostname="js1.blockelite.cn") as stream:
                assert hashlib.sha256(stream.getpeercert(binary_form=True)).hexdigest() == expected_cert
        gateway_env.write_text(
            f"YGGDRASIL_ROOT={ROOT}\nYGGDRASIL_GATEWAY_PORT=8802\n"
            "YGGDRASIL_GATEWAY_BIND=0.0.0.0\nSILLYTAVERN_UPSTREAM_PORT=8815\n"
        )
        gateway_env.chmod(0o600)
        run("systemctl", "--user", "restart", "yggdrasil-gateway.service")
        wait_port(8802)
        for host, path, expected in (
            ("tavern.apeirianetwork.com", "/", 200),
            ("tavern.apeirianetwork.com", "/api/api-profiles", 401),
            ("js1.blockelite.cn", "/", 401),
        ):
            actual = https_status(host, 8802, path)
            if actual != expected:
                raise RuntimeError(f"{host}{path} returned HTTP {actual}; expected {expected}")
        run("systemctl", "--user", "enable", "sillytavern-upstream.service", "yggdrasil-gateway.service")
        state = {"gateway_port": 8802, "public_port": 15266, "backend_port": 8811,
                 "sillytavern_port": 8815, "certificates": "self-signed", "cloudflare": "DNS only"}
        (SHARED / "deployment-state.json").write_text(json.dumps(state, indent=2))
        print(json.dumps(state))
    except Exception as failure:
        if switched:
            try:
                run("systemctl", "--user", "stop", "yggdrasil-gateway.service")
                run("systemctl", "--user", "stop", "sillytavern-upstream.service")
                unit.write_text("\n".join(
                    "ExecStart=/home/linuxbrew/.linuxbrew/bin/node server.js --port 8802 --listen true"
                    if line.startswith("ExecStart=") else line
                    for line in original_unit.splitlines()
                ) + "\n")
                run("systemctl", "--user", "daemon-reload")
                run("systemctl", "--user", "start", "sillytavern-upstream.service")
                wait_port(8802)
                gateway_env.write_text(original_gateway)
                run("systemctl", "--user", "start", "yggdrasil-gateway.service")
                print("Activation failed; the original SillyTavern public listener was restored.")
            except Exception as recovery:
                raise RuntimeError(f"Activation failed ({failure}); restoration also failed ({recovery})") from recovery
        raise


if __name__ == "__main__":
    main()
