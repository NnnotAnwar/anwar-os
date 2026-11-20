"""Helpers shared by the handlers."""

from __future__ import annotations

import logging
import re

from aiogram.types import LinkPreviewOptions, Message

from ..api import ApiError

log = logging.getLogger(__name__)

NO_PREVIEW = LinkPreviewOptions(is_disabled=True)
URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
UNREACHABLE = "Couldn't reach anwar.os. Try again in a minute."


def message_content(message: Message) -> tuple[str, str | None]:
    """The text (or caption) of a message and the first link in it, if any.

    Hidden links (text_link entities: "click here" pointing somewhere) count too,
    which matters for forwarded channel posts.
    """
    text = message.text or message.caption or ""
    entities = message.entities or message.caption_entities or []
    for entity in entities:
        if entity.type == "text_link" and entity.url:
            return text, entity.url
        if entity.type == "url":
            return text, entity.extract_from(text)
    match = URL_RE.search(text)
    return text, match.group(0) if match else None


def error_text(error: Exception) -> str:
    """What to tell the owner when an API call failed."""
    if isinstance(error, ApiError) and 400 <= error.status < 500 and error.message:
        return f"❌ {error.message}"
    log.warning("api call failed", exc_info=error)
    return f"❌ {UNREACHABLE}"
