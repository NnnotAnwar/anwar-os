"""Parsing and formatting of amounts. Money is integer minor units (1 CZK = 100)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal

# Up to 9 integer digits and 2 decimals, "." or "," as separator: 15, 15.5, 15,50.
_AMOUNT = r"\d{1,9}(?:[.,]\d{1,2})?"
_AMOUNT_RE = re.compile(rf"^{_AMOUNT}$")
# Optional currency word after the amount: "250 kč", "250czk", "250,-".
_CURRENCY_WORD = r"(?:\s*(?:kč|kc|czk|,-))?"
# "250 coffee", "250kč coffee", "15,50" -> amount first, then an optional note.
_ENTRY_AMOUNT_FIRST = re.compile(rf"^(?P<amount>{_AMOUNT}){_CURRENCY_WORD}(?:\s+(?P<rest>.+))?$", re.IGNORECASE | re.DOTALL)
# "coffee 250" -> note first, amount last.
_ENTRY_AMOUNT_LAST = re.compile(rf"^(?P<rest>.+?)\s+(?P<amount>{_AMOUNT}){_CURRENCY_WORD}$", re.IGNORECASE | re.DOTALL)

NOTE_MAX_LENGTH = 200

NBSP = "\u00a0"  # keeps "1 250 CZK" on one line


@dataclass(frozen=True)
class Entry:
    amount_minor: int
    text: str | None  # what followed the amount: a category, a note, or both


def parse_amount(text: str | None) -> int | None:
    """Return the amount in minor units, or None if the text is not a positive amount."""
    if not text:
        return None
    text = text.strip()
    if not _AMOUNT_RE.match(text):
        return None
    minor = int(Decimal(text.replace(",", ".")) * 100)
    return minor if minor > 0 else None


def parse_entry(text: str | None) -> Entry | None:
    """Parse a quick entry like "250", "250 coffee", "15,50 food lunch" or "coffee 250"."""
    if not text:
        return None
    text = " ".join(text.split())  # collapse whitespace and newlines
    match = _ENTRY_AMOUNT_FIRST.match(text) or _ENTRY_AMOUNT_LAST.match(text)
    if match is None:
        return None
    amount = parse_amount(match["amount"])
    if amount is None:
        return None
    rest = (match["rest"] or "").strip() or None
    return Entry(amount, rest[:NOTE_MAX_LENGTH] if rest else None)


def _group(whole: int) -> str:
    return f"{whole:,}".replace(",", NBSP)


def format_number(minor: int, *, whole_only: bool = False) -> str:
    """1250 -> "12.50", 125000 -> "1 250" (hundredths are dropped when zero)."""
    sign = "-" if minor < 0 else ""
    whole, cents = divmod(abs(minor), 100)
    if whole_only:
        whole += 1 if cents >= 50 else 0
        return f"{sign}{_group(whole)}"
    if cents == 0:
        return f"{sign}{_group(whole)}"
    return f"{sign}{_group(whole)}.{cents:02d}"


def format_amount(minor: int, currency: str, *, whole_only: bool = False) -> str:
    """125000, "CZK" -> "1 250 CZK"; 1550 -> "15.50 CZK" (non-breaking spaces)."""
    return f"{format_number(minor, whole_only=whole_only)}{NBSP}{currency}"
