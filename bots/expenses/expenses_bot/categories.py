"""Categories: the built-in set, their emoji, and short stable tokens for buttons.

Categories are stored as plain text in expenses.category (unchanged from the old bot),
so imported or older rows may carry names outside the built-in set; those still work
everywhere. Buttons refer to a category by a short hash of its name, because callback
data is limited to 64 bytes and names may contain any character.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable

DEFAULT_CATEGORIES = ["Food", "Transport", "Utilities", "Entertainment", "Health", "Other"]

_EMOJI = {
    "food": "🍔",
    "transport": "🚌",
    "utilities": "💡",
    "entertainment": "🎬",
    "health": "💊",
    "other": "📦",
}
_FALLBACK_EMOJI = "🏷"

MAX_CATEGORY_LENGTH = 64


def emoji(category: str) -> str:
    return _EMOJI.get(category.casefold(), _FALLBACK_EMOJI)


def label(category: str) -> str:
    """Button / card label, e.g. "🍔 Food"."""
    return f"{emoji(category)} {category}"


def token(category: str) -> str:
    """8 hex chars identifying a category name inside callback data."""
    return hashlib.blake2s(category.encode(), digest_size=4).hexdigest()


def resolve(tok: str, candidates: Iterable[str]) -> str | None:
    for name in candidates:
        if token(name) == tok:
            return name
    return None


def merge(*groups: Iterable[str]) -> list[str]:
    """Concatenate name lists, keeping the first spelling of each (case-insensitive)."""
    seen: set[str] = set()
    out: list[str] = []
    for group in groups:
        for name in group:
            key = name.casefold()
            if name and key not in seen:
                seen.add(key)
                out.append(name)
    return out


def match(text: str, candidates: Iterable[str]) -> tuple[str, str | None] | None:
    """Find a category in free text: the whole text, or its first word + a note.

    "food" -> ("Food", None); "food lunch with Eva" -> ("Food", "lunch with Eva").
    """
    by_key = {name.casefold(): name for name in candidates}
    text = text.strip()
    if text.casefold() in by_key:
        return by_key[text.casefold()], None
    first, _, rest = text.partition(" ")
    if first.casefold() in by_key and rest.strip():
        return by_key[first.casefold()], rest.strip()
    return None


def picker_order(frequent: Iterable[str], limit: int = 9) -> list[str]:
    """Most used first, then the remaining built-in categories, at most `limit` entries."""
    ordered = merge(frequent, DEFAULT_CATEGORIES)
    head = ordered[:limit]
    if any(name.casefold() == "other" for name in head):
        return head
    # Keep "Other" reachable even when the user's history fills the grid.
    return [*ordered[: limit - 1], "Other"]
