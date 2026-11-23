"""One-time copy of the bot's old database (schema bot_expenses) into Budget.

    python -m expenses_bot import-to-budget --dry-run     what would happen
    python -m expenses_bot import-to-budget               do it

Reads every row of bot_expenses.expenses (DATABASE_URL, as role bot_expenses) and sends
it to the web app's import endpoint (/api/internal/budget-bot/import), which writes it
through Budget's own importTransactions action as the site owner:

- into the default account (the first CZK account), as an expense (money out);
- category by name among Budget's expense categories (case-insensitive), the old
  "Entertainment" as "Fun", anything else as "Other" (uncategorised if there is none);
- the note as is, the day in Prague time, the original timestamp as the time of day;
- with the key "bot-expenses:<id>". Budget stores it (unique per owner), so running the
  command again imports nothing twice, even after the rows were edited in Budget.

Only the owner's rows are copied: BOT_EXPENSES_OWNER_ID (or --telegram-user) picks the
Telegram user; with neither, the import refuses when the table has more than one user
(--all-users copies everyone's rows into the owner's Budget). Nothing in bot_expenses is
changed or deleted.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .api import ApiError, ApiUnreachable, BudgetApi, Category
from .config import MIN_SECRET_LENGTH
from .errors import describe
from .periods import to_local

log = logging.getLogger(__name__)

BATCH = 200
KEY_PREFIX = "bot-expenses:"
# The old bot's built-in categories that Budget names differently.
ALIASES = {"entertainment": "fun"}
FALLBACK = "other"

SELECT_ROWS = """
    select id, telegram_user_id, amount_minor, currency, category, note, created_at
    from bot_expenses.expenses
    order by id
"""


@dataclass(frozen=True)
class OldRow:
    id: int
    telegram_user_id: int
    amount_minor: int
    currency: str
    category: str
    note: str | None
    created_at: datetime


@dataclass
class Plan:
    rows: list[dict[str, Any]] = field(default_factory=list)
    # old category name -> Budget category name (None = uncategorised), with counts
    mapping: Counter[tuple[str, str | None]] = field(default_factory=Counter)
    other_users: Counter[int] = field(default_factory=Counter)
    skipped: list[str] = field(default_factory=list)


class ImportRefused(Exception):
    pass


def map_category(name: str, categories: Sequence[Category]) -> str | None:
    """Budget's name for an old category: same name, a known alias, else Other (else None)."""
    by_name = {c.name.casefold(): c.name for c in categories}
    key = name.strip().casefold()
    if key in by_name:
        return by_name[key]
    alias = ALIASES.get(key)
    if alias and alias in by_name:
        return by_name[alias]
    return by_name.get(FALLBACK)


def owners(rows: Iterable[OldRow]) -> Counter[int]:
    return Counter(r.telegram_user_id for r in rows)


def choose_user(rows: Sequence[OldRow], telegram_user: int | None, all_users: bool) -> int | None:
    """The Telegram user whose rows are copied; None = everyone's."""
    if all_users:
        return None
    if telegram_user is not None:
        return telegram_user
    users = owners(rows)
    if len(users) > 1:
        listing = ", ".join(f"{uid} ({n} rows)" for uid, n in users.most_common())
        raise ImportRefused(
            f"bot_expenses.expenses has rows of several Telegram users: {listing}. "
            "Set BOT_EXPENSES_OWNER_ID or pass --telegram-user <id> (or --all-users)."
        )
    return None


def plan(rows: Sequence[OldRow], categories: Sequence[Category], user: int | None) -> Plan:
    result = Plan()
    for row in rows:
        if user is not None and row.telegram_user_id != user:
            result.other_users[row.telegram_user_id] += 1
            continue
        if row.amount_minor <= 0:
            result.skipped.append(f"{KEY_PREFIX}{row.id}: amount {row.amount_minor} is not above zero")
            continue
        target = map_category(row.category, categories)
        result.mapping[(row.category, target)] += 1
        result.rows.append(
            {
                "key": f"{KEY_PREFIX}{row.id}",
                "amountMinor": row.amount_minor,
                "currency": row.currency.strip().upper(),
                "occurredOn": to_local(row.created_at).date().isoformat(),
                "recordedAt": row.created_at.isoformat(),
                "categoryName": target,
                "note": (row.note or "").strip()[:500],
            }
        )
    return result


async def send(api: BudgetApi, rows: Sequence[dict[str, Any]], *, dry_run: bool) -> tuple[int, int]:
    """Posts the rows in batches; returns (imported or would import, already in Budget)."""
    imported = existing = 0
    for start in range(0, len(rows), BATCH):
        result = await api.import_rows(list(rows[start : start + BATCH]), dry_run=dry_run)
        imported += int(result["imported"])
        existing += int(result["existing"])
    return imported, existing


async def read_old_rows(database_url: str) -> list[OldRow]:
    import asyncpg  # only this command needs the old database

    conn = await asyncpg.connect(database_url, server_settings={"application_name": "bot-expenses-import"})
    try:
        exists = await conn.fetchval("select to_regclass('bot_expenses.expenses') is not null")
        if not exists:
            return []
        records = await conn.fetch(SELECT_ROWS)
    finally:
        await conn.close()
    return [
        OldRow(
            id=r["id"],
            telegram_user_id=r["telegram_user_id"],
            amount_minor=r["amount_minor"],
            currency=r["currency"],
            category=r["category"],
            note=r["note"],
            created_at=r["created_at"],
        )
        for r in records
    ]


async def run(
    api: BudgetApi,
    rows: Sequence[OldRow],
    *,
    dry_run: bool,
    telegram_user: int | None,
    all_users: bool,
    out: Any = sys.stdout,
) -> int:
    def say(line: str = "") -> None:
        print(line, file=out)

    if not rows:
        say("Nothing to import: bot_expenses.expenses is empty or doesn't exist.")
        return 0
    user = choose_user(rows, telegram_user, all_users)
    setup = await api.setup(fresh=True)
    result = plan(rows, setup.categories, user)

    say(f"Rows in bot_expenses.expenses: {len(rows)}")
    if user is not None:
        say(f"Telegram user {user}: {len(result.rows) + len(result.skipped)} rows")
    for uid, n in result.other_users.most_common():
        say(f"  left out: {n} rows of Telegram user {uid}")
    for line in result.skipped:
        say(f"  skipped {line}")
    say("Categories:")
    for (old, new), n in sorted(result.mapping.items(), key=lambda x: (-x[1], x[0][0])):
        say(f"  {old} -> {new or 'uncategorised'}: {n}")
    if not result.rows:
        say("Nothing to import.")
        return 0

    imported, existing = await send(api, result.rows, dry_run=dry_run)
    account = next((a for a in setup.accounts if a.get("id") == setup.default_account_id), {})
    where = f"account “{account.get('name', '?')}” ({account.get('currency', setup.currency)})"
    if dry_run:
        say(f"Dry run: {imported} would be imported into {where}, {existing} already in Budget.")
    else:
        say(f"Imported {imported} into {where}; {existing} were already in Budget.")
    log.info("import to budget", extra={"dry_run": dry_run, "imported": imported, "existing": existing})
    return 0


def main(argv: Sequence[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m expenses_bot import-to-budget", description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="only report what would be imported")
    parser.add_argument("--telegram-user", type=int, help="copy only this Telegram user's rows (default: BOT_EXPENSES_OWNER_ID)")
    parser.add_argument("--all-users", action="store_true", help="copy every user's rows into the owner's Budget")
    args = parser.parse_args(list(argv))

    env = os.environ
    missing = [n for n in ("DATABASE_URL", "BOT_EXPENSES_API_URL", "BOT_EXPENSES_API_SECRET") if not env.get(n, "").strip()]
    if missing:
        print(f"missing required environment variables: {', '.join(missing)}", file=sys.stderr)
        return 2
    secret = env["BOT_EXPENSES_API_SECRET"].strip()
    if len(secret) < MIN_SECRET_LENGTH:
        print(f"BOT_EXPENSES_API_SECRET must be at least {MIN_SECRET_LENGTH} characters", file=sys.stderr)
        return 2
    telegram_user = args.telegram_user
    if telegram_user is None and not args.all_users and env.get("BOT_EXPENSES_OWNER_ID", "").strip():
        try:
            telegram_user = int(env["BOT_EXPENSES_OWNER_ID"].strip())
        except ValueError:
            print("BOT_EXPENSES_OWNER_ID must be a number", file=sys.stderr)
            return 2

    async def go() -> int:
        rows = await read_old_rows(env["DATABASE_URL"].strip())
        async with BudgetApi(env["BOT_EXPENSES_API_URL"].strip(), secret) as api:
            return await run(api, rows, dry_run=args.dry_run, telegram_user=telegram_user, all_users=args.all_users)

    try:
        return asyncio.run(go())
    except ImportRefused as exc:
        print(str(exc), file=sys.stderr)
        return 3
    except (ApiError, ApiUnreachable) as exc:
        problem = describe(exc, action="import")
        print(f"{problem.title}: {problem.detail}".rstrip(": "), file=sys.stderr)
        return 1
