"""Parsing and formatting of amounts. Money is integer minor units (1 CZK = 100)."""

from __future__ import annotations

import re
from decimal import Decimal

# Up to 9 integer digits and 2 decimals, "." or "," as separator: 15, 15.5, 15,50.
_AMOUNT_RE = re.compile(r"^\d{1,9}(?:[.,]\d{1,2})?$")


def parse_amount(text: str | None) -> int | None:
    """Return the amount in minor units, or None if the text is not a positive amount."""
    if not text:
        return None
    text = text.strip()
    if not _AMOUNT_RE.match(text):
        return None
    minor = int(Decimal(text.replace(",", ".")) * 100)
    return minor if minor > 0 else None


def format_amount(minor: int, currency: str) -> str:
    sign = "-" if minor < 0 else ""
    whole, cents = divmod(abs(minor), 100)
    return f"{sign}{whole}.{cents:02d} {currency}"
