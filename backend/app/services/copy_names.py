from itertools import count
from typing import Iterable


def copy_name(original: str, existing: Iterable[str], max_length: int | None = None) -> str:
    names = set(existing)
    for number in count(1):
        suffix = "（副本）" if number == 1 else f"（副本 {number}）"
        stem = original if max_length is None else original[:max_length - len(suffix)]
        candidate = stem + suffix
        if candidate not in names:
            return candidate
    raise AssertionError("Could not allocate a copy name")
