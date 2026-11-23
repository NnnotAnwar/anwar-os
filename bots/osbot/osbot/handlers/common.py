"""Helpers shared by the handlers."""

from __future__ import annotations

import re
from typing import Any

URL_RE = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
COMMAND_RE = re.compile(r"^/[A-Za-z0-9_]+(?:@\w+)?\s*")


def message_content(message: Any) -> tuple[str, str | None]:
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


def without_command(text: str) -> str:
    """"/note Milk" → "Milk" (for retrying a command from its message)."""
    return COMMAND_RE.sub("", text, count=1) if text.startswith("/") else text
