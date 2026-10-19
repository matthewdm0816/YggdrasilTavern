"""Never let local service credentials or databases become test defaults.

Authentication tests pass explicit Settings or monkeypatch these values.
Empty process values also override the developer's backend/.env file.
"""

import os
import tempfile
from pathlib import Path


os.environ.update(
    TREECHAT_DATABASE_URL="sqlite:///:memory:",
    YGGDRASIL_AUTH_ENABLED="false",
    YGGDRASIL_AUTH_USERNAME="",
    YGGDRASIL_AUTH_PASSWORD="",
    YGGDRASIL_AUTH_SECRET="",
    YGGDRASIL_AUTH_COOKIE_SECURE="false",
)

runtime = Path(__file__).resolve().parents[2] / ".yggdrasil-runtime"
test_temp = runtime / "test-temp"
test_temp.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(test_temp)
os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(runtime / "test-cache/tiktoken"))
