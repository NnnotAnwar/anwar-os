"""One-off import of the old SQLite expenses.db into the bot_expenses schema.

    DATABASE_URL=postgresql://bot_expenses:...@host:5432/db \\
        python scripts/import_sqlite.py /path/to/expenses.db [--dry-run]

Old schema: expenses(id INTEGER, user_id INTEGER, amount REAL, category TEXT, date TIMESTAMP)

- amount (REAL, e.g. 15.5) becomes amount_minor (integer, 1550): the float is read via
  its shortest decimal representation and rounded half-up to 2 decimals.
- currency: the old bot had none (it printed "$"); every row gets --currency (default CZK).
- date: naive local timestamps written by the old bot; interpreted in --timezone
  (default Europe/Prague) and stored as timestamptz.
- Each row is stored with external_ref 'sqlite:<id>', so re-running the import skips
  rows that were already imported.
- users rows are created/extended from the imported data (username stays empty
  until the user writes to the bot again).
- Rows that cannot be converted (no user, amount <= 0, unparsable date) are skipped
  and reported.

Everything is written in one transaction: either the whole file is imported or nothing.
Run migrations first (`python -m expenses_bot migrate`) so the schema exists.
"""

from __future__ import annotations

import argparse
import asyncio
import math
import os
import re
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo

import asyncpg


@dataclass
class ImportRow:
    legacy_id: int
    telegram_user_id: int
    amount_minor: int
    currency: str
    category: str
    created_at: datetime

    @property
    def external_ref(self) -> str:
        return f"sqlite:{self.legacy_id}"


@dataclass
class ImportReport:
    read: int = 0
    inserted: int = 0
    already_imported: int = 0
    skipped: list[tuple[object, str]] = field(default_factory=list)  # (legacy id, reason)
    users: int = 0

    def summary(self) -> str:
        lines = [
            f"rows read:        {self.read}",
            f"inserted:         {self.inserted}",
            f"already imported: {self.already_imported}",
            f"skipped:          {len(self.skipped)}",
            f"users touched:    {self.users}",
        ]
        lines += [f"  - id {legacy_id}: {reason}" for legacy_id, reason in self.skipped]
        return "\n".join(lines)


def amount_to_minor(value: object) -> int:
    """Convert an old REAL/TEXT amount to integer minor units (raises ValueError)."""
    if value is None or isinstance(value, bool):
        raise ValueError("empty amount")
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"non-finite amount {value!r}")
    try:
        # str(float) is the shortest repr that round-trips: 15.5 -> "15.5", 0.1 -> "0.1"
        dec = Decimal(str(value).strip().replace(",", "."))
    except InvalidOperation as exc:
        raise ValueError(f"not a number: {value!r}") from exc
    if not dec.is_finite():
        raise ValueError(f"non-finite amount {value!r}")
    minor = int((dec * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    if minor <= 0:
        raise ValueError(f"amount must be positive, got {value!r}")
    return minor


_DATE_FORMATS = ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d")


def parse_legacy_date(value: object, tz: ZoneInfo) -> datetime:
    """Parse the old naive local timestamp (raises ValueError)."""
    if value is None:
        raise ValueError("empty date")
    if isinstance(value, (int, float)):  # unix seconds, just in case
        return datetime.fromtimestamp(float(value), tz)
    text = str(value).strip()
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        for fmt in _DATE_FORMATS:
            try:
                parsed = datetime.strptime(text, fmt)
                break
            except ValueError:
                continue
        else:
            raise ValueError(f"unparsable date {text!r}") from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=tz)


_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def read_sqlite(path: Path, currency: str, tz: ZoneInfo, report: ImportReport) -> list[ImportRow]:
    # Read-only URI: the source file is never modified.
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        cursor = conn.execute("SELECT id, user_id, amount, category, date FROM expenses ORDER BY id")
        rows: list[ImportRow] = []
        for legacy_id, user_id, amount, category, date in cursor:
            report.read += 1
            try:
                if legacy_id is None:
                    raise ValueError("no id")
                if user_id is None:
                    raise ValueError("no user_id")
                category_text = (str(category).strip() if category is not None else "") or "Other"
                rows.append(
                    ImportRow(
                        legacy_id=int(legacy_id),
                        telegram_user_id=int(user_id),
                        amount_minor=amount_to_minor(amount),
                        currency=currency,
                        category=category_text[:64],
                        created_at=parse_legacy_date(date, tz),
                    )
                )
            except (ValueError, TypeError) as exc:
                report.skipped.append((legacy_id, str(exc)))
        return rows
    finally:
        conn.close()


async def write_rows(conn: asyncpg.Connection, rows: list[ImportRow], report: ImportReport) -> None:
    users: dict[int, tuple[datetime, datetime]] = {}
    for row in rows:
        first, last = users.get(row.telegram_user_id, (row.created_at, row.created_at))
        users[row.telegram_user_id] = (min(first, row.created_at), max(last, row.created_at))

    async with conn.transaction():
        for telegram_id, (first_seen, last_seen) in users.items():
            await conn.execute(
                """
                insert into bot_expenses.users (telegram_id, first_seen, last_seen)
                values ($1, $2, $3)
                on conflict (telegram_id) do update
                  set first_seen = least(bot_expenses.users.first_seen, excluded.first_seen),
                      last_seen  = greatest(bot_expenses.users.last_seen, excluded.last_seen)
                """,
                telegram_id,
                first_seen,
                last_seen,
            )
        report.users = len(users)
        for row in rows:
            status = await conn.execute(
                """
                insert into bot_expenses.expenses
                  (telegram_user_id, amount_minor, currency, category, created_at, external_ref)
                values ($1, $2, $3, $4, $5, $6)
                on conflict (external_ref) do nothing
                """,
                row.telegram_user_id,
                row.amount_minor,
                row.currency,
                row.category,
                row.created_at,
                row.external_ref,
            )
            if status.endswith(" 1"):
                report.inserted += 1
            else:
                report.already_imported += 1


async def import_sqlite(
    sqlite_path: Path,
    database_url: str,
    *,
    currency: str = "CZK",
    timezone: str = "Europe/Prague",
    dry_run: bool = False,
) -> ImportReport:
    if not _CURRENCY_RE.match(currency):
        raise ValueError(f"currency must be a 3-letter ISO code, got {currency!r}")
    if not sqlite_path.is_file():
        raise FileNotFoundError(sqlite_path)
    report = ImportReport()
    rows = read_sqlite(sqlite_path, currency, ZoneInfo(timezone), report)
    if dry_run:
        return report
    conn = await asyncpg.connect(database_url)
    try:
        await write_rows(conn, rows, report)
    finally:
        await conn.close()
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import the old SQLite expenses.db into Postgres.")
    parser.add_argument("sqlite_path", type=Path, help="path to the old expenses.db")
    parser.add_argument("--database-url", default=os.environ.get("DATABASE_URL"), help="default: $DATABASE_URL")
    parser.add_argument("--currency", default="CZK", help="currency for all old rows (default CZK)")
    parser.add_argument("--timezone", default="Europe/Prague", help="timezone of the old naive dates")
    parser.add_argument("--dry-run", action="store_true", help="only read and validate, write nothing")
    args = parser.parse_args(argv)
    if not args.database_url and not args.dry_run:
        parser.error("set DATABASE_URL or pass --database-url")

    report = asyncio.run(
        import_sqlite(
            args.sqlite_path,
            args.database_url or "",
            currency=args.currency.upper(),
            timezone=args.timezone,
            dry_run=args.dry_run,
        )
    )
    print(("DRY RUN, nothing written\n" if args.dry_run else "") + report.summary())
    return 0


if __name__ == "__main__":
    sys.exit(main())
