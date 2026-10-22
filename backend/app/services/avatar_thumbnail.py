"""Generate small character avatars to persist alongside the original images.

Lists read the persisted thumbnail instead of loading and decoding full avatars.
Detail endpoints keep returning the original so editors still see the full picture.
"""

from __future__ import annotations

import base64
import io
import logging

from PIL import Image

LOGGER = logging.getLogger(__name__)

THUMBNAIL_SIZE = 128


def _encode_thumbnail(raw: bytes, size: int) -> str:
    with Image.open(io.BytesIO(raw)) as image:
        image.load()
        alpha = image.mode in ("RGBA", "LA", "P")
        image.thumbnail((size, size))
        prepared = image.convert("RGBA" if alpha else "RGB")
        buffer = io.BytesIO()
        prepared.save(buffer, format="WEBP", quality=80, method=4)
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def thumbnail_data_url(data_url: str | None, size: int = THUMBNAIL_SIZE) -> str | None:
    """Generate a thumbnail when an avatar is stored or backfilled.

    Remote avatar URLs are returned unchanged: fetching them would block writes
    on the network. Undecodable image data is logged and returned unchanged so a
    broken avatar cannot prevent saving the rest of the character.
    """
    if not data_url:
        return None
    if not data_url.startswith("data:image/") or ";base64," not in data_url:
        return data_url

    try:
        raw = base64.b64decode(data_url.split(",", 1)[1], validate=True)
        return _encode_thumbnail(raw, size)
    except Exception:
        LOGGER.warning("Unable to build an avatar thumbnail; returning the original.", exc_info=True)
        return data_url
