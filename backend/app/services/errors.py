"""Application errors independent of the HTTP transport."""

from __future__ import annotations

from typing import Any


class ApplicationError(Exception):
    def __init__(self, status_code: int, detail: Any) -> None:
        self.status_code = status_code
        self.detail = detail
        super().__init__(str(detail))
