"""Categories: Budget's expense categories, their emoji, and short tokens for buttons.

The categories themselves live in Budget (anwar.os); the bot gets them from the API,
most used in the last 90 days first. Buttons refer to a category by a short hash of
its id, because callback data is limited to 64 bytes.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from typing import Protocol

# By name (case-insensitive): Budget's default categories plus the old bot's.
_EMOJI = {
    "food": "🍔",
    "groceries": "🛒",
    "eating out": "🍽",
    "housing": "🏠",
    "rent": "🏠",
    "utilities": "💡",
    "transport": "🚌",
    "health": "💊",
    "shopping": "🛍",
    "fun": "🎉",
    "entertainment": "🎬",
    "subscriptions": "🔁",
    "travel": "✈️",
    "gifts": "🎁",
    "education": "📚",
    "other": "📦",
    "uncategorised": "❔",
}
_FALLBACK_EMOJI = "🏷"

PICKER_SIZE = 9


class Named(Protocol):
    id: str
    name: str


def emoji(category: str) -> str:
    return _EMOJI.get(category.casefold(), _FALLBACK_EMOJI)


def label(category: str) -> str:
    """Button / card label, e.g. "🍔 Food"."""
    return f"{emoji(category)} {category}"


def token(category_id: str) -> str:
    """8 hex chars identifying a category inside callback data."""
    return hashlib.blake2s(category_id.encode(), digest_size=4).hexdigest()


def resolve[C: Named](tok: str, candidates: Sequence[C]) -> C | None:
    for category in candidates:
        if token(category.id) == tok:
            return category
    return None


def picker_order[C: Named](ranked: Sequence[C], limit: int = PICKER_SIZE) -> list[C]:
    """The first `limit` of Budget's order (most used first), keeping "Other" reachable."""
    head = list(ranked[:limit])
    if any(c.name.casefold() == "other" for c in head):
        return head
    other = next((c for c in ranked if c.name.casefold() == "other"), None)
    if other is None:
        return head
    return [*ranked[: limit - 1], other]


def with_current[C: Named](names: Sequence[C], current: C | None) -> list[C]:
    """The picker plus the expense's own category when it isn't among them."""
    if current is None or any(c.id == current.id for c in names):
        return list(names)
    return [*names, current]
