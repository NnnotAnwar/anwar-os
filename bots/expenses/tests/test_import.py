"""python -m expenses_bot import-to-budget: mapping, user choice, idempotency, the old schema."""

from __future__ import annotations

import io
import os
import secrets
import shlex
import subprocess
from datetime import UTC, date, datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

from expenses_bot import import_to_budget as imp
from expenses_bot.api import Category

from .conftest import needs_db

CATS = [Category(id=str(i), name=n) for i, n in enumerate(["Food", "Fun", "Health", "Other", "Utilities"])]


def row(i: int, category: str = "Food", amount: int = 15050, user: int = 42, at: datetime | None = None, note: str | None = None):
    return imp.OldRow(i, user, amount, "CZK", category, note, at or datetime(2026, 11, 20, 7, 15, tzinfo=UTC))


def test_categories_map_by_name_alias_then_other():
    assert imp.map_category("food", CATS) == "Food"
    assert imp.map_category(" Health ", CATS) == "Health"
    assert imp.map_category("Entertainment", CATS) == "Fun"
    assert imp.map_category("Groceries", CATS) == "Other"
    assert imp.map_category("Groceries", [c for c in CATS if c.name != "Other"]) is None


def test_only_one_users_rows_unless_told_otherwise():
    rows = [row(1, user=42), row(2, user=42), row(3, user=7)]
    with pytest.raises(imp.ImportRefused, match=r"42 \(2 rows\), 7 \(1 rows\)"):
        imp.choose_user(rows, None, False)
    assert imp.choose_user(rows, 42, False) == 42
    assert imp.choose_user(rows, None, True) is None
    assert imp.choose_user([row(1), row(2)], None, False) is None


def test_plan_converts_rows_for_budget():
    late = datetime(2026, 11, 20, 23, 30, tzinfo=UTC)  # already the 21st in Prague
    result = imp.plan([row(1, note=" coffee "), row(2, "Entertainment", at=late), row(3, user=7), row(4, amount=0)], CATS, 42)
    assert result.rows == [
        {"key": "bot-expenses:1", "amountMinor": 15050, "currency": "CZK", "occurredOn": "2026-11-20",
         "recordedAt": "2026-11-20T07:15:00+00:00", "categoryName": "Food", "note": "coffee"},
        {"key": "bot-expenses:2", "amountMinor": 15050, "currency": "CZK", "occurredOn": "2026-11-21",
         "recordedAt": "2026-11-20T23:30:00+00:00", "categoryName": "Fun", "note": ""},
    ]
    assert dict(result.other_users) == {7: 1}
    assert result.skipped == ["bot-expenses:4: amount 0 is not above zero"]


async def test_import_is_idempotent_end_to_end(budget):
    rows = [row(i, c) for i, c in enumerate(["Food", "Food", "Entertainment", "Pets"], start=1)]
    out = io.StringIO()
    await imp.run(budget.api, rows, dry_run=True, telegram_user=None, all_users=False, out=out)
    assert "Dry run: 4 would be imported" in out.getvalue()
    assert budget.fake.expenses() == []

    out = io.StringIO()
    await imp.run(budget.api, rows, dry_run=False, telegram_user=None, all_users=False, out=out)
    assert "Imported 4 into account “Main account” (CZK); 0 were already in Budget." in out.getvalue()
    assert "Entertainment -> Fun: 1" in out.getvalue() and "Pets -> Other: 1" in out.getvalue()
    imported = budget.fake.expenses()
    assert sorted(t.import_key for t in imported) == [f"bot-expenses:{i}" for i in range(1, 5)]
    assert {t.occurred_on for t in imported} == {date(2026, 11, 20)}

    # Run it again (and once more after a new row appeared): nothing doubles.
    out = io.StringIO()
    await imp.run(budget.api, [*rows, row(5)], dry_run=False, telegram_user=None, all_users=False, out=out)
    assert "Imported 1 into" in out.getvalue() and "4 were already in Budget" in out.getvalue()
    assert len(budget.fake.expenses()) == 5


async def test_import_batches_large_tables(budget, monkeypatch):
    monkeypatch.setattr(imp, "BATCH", 3)
    await imp.run(budget.api, [row(i) for i in range(1, 9)], dry_run=False, telegram_user=None, all_users=False, out=io.StringIO())
    assert sum(c["path"].endswith("/import") for c in budget.fake.calls) == 3
    assert len(budget.fake.expenses()) == 8


async def test_nothing_to_import(budget):
    out = io.StringIO()
    assert await imp.run(budget.api, [], dry_run=False, telegram_user=None, all_users=False, out=out) == 0
    assert "Nothing to import" in out.getvalue()
    assert budget.fake.calls == []


def test_cli_refuses_without_its_settings(monkeypatch, capsys):
    for name in ("DATABASE_URL", "BOT_EXPENSES_API_URL", "BOT_EXPENSES_API_SECRET", "BOT_EXPENSES_OWNER_ID"):
        monkeypatch.delenv(name, raising=False)
    assert imp.main([]) == 2
    assert "DATABASE_URL" in capsys.readouterr().err


# --- the real old schema (needs a throwaway Postgres) -----------------------------

ROOT = Path(__file__).resolve().parent.parent


def _with_db(url: str, dbname: str, user: str | None = None, password: str | None = None) -> str:
    parts = urlsplit(url)
    host = parts.hostname or "localhost"
    port = f":{parts.port}" if parts.port else ""
    user = user or parts.username or ""
    password = password if password is not None else (parts.password or "")
    auth = f"{user}:{password}@" if password else (f"{user}@" if user else "")
    return urlunsplit((parts.scheme, f"{auth}{host}{port}", f"/{dbname}", "", ""))


@needs_db
async def test_reads_the_old_bot_expenses_table():
    import asyncpg

    admin_url = os.environ["TEST_DATABASE_URL"]
    psql = shlex.split(os.environ.get("TEST_PSQL", "psql"))
    name = "expenses_import_" + secrets.token_hex(4)
    password = "test-" + secrets.token_hex(8)
    admin = await asyncpg.connect(admin_url)
    try:
        if await admin.fetchval("select 1 from pg_roles where rolname = 'bot_expenses'"):
            pytest.skip("role bot_expenses already exists; use a fresh throwaway Postgres")
        await admin.execute(f'create database "{name}"')
    finally:
        await admin.close()
    try:
        # Exactly what production has: bootstrap.sql, then the bot's old migrations as its role.
        subprocess.run(
            [*psql, "-X", "-q", "-d", name, "-v", "ON_ERROR_STOP=1", "-v", f"bot_password={password}", "-f", "-"],
            input=(ROOT / "db" / "bootstrap.sql").read_text(), text=True, check=True, capture_output=True, timeout=60,
        )
        bot_url = _with_db(admin_url, name, "bot_expenses", password)
        conn = await asyncpg.connect(bot_url, server_settings={"search_path": "bot_expenses"})
        try:
            for path in sorted((ROOT / "db" / "migrations").glob("*.sql")):
                await conn.execute(path.read_text())
            await conn.execute("insert into bot_expenses.users (telegram_id) values (42)")
            await conn.execute(
                "insert into bot_expenses.expenses (telegram_user_id, amount_minor, currency, category, note, created_at)"
                " values (42, 25000, 'CZK', 'Food', 'lunch', '2026-11-22 08:15+00'), (42, 900, 'CZK', 'Other', null, now())"
            )
        finally:
            await conn.close()

        rows = await imp.read_old_rows(bot_url)
        assert [(r.amount_minor, r.category, r.note) for r in rows] == [(25000, "Food", "lunch"), (900, "Other", None)]
        assert rows[0].created_at == datetime(2026, 11, 22, 8, 15, tzinfo=UTC)
        # A database without the schema has nothing to import.
        assert await imp.read_old_rows(admin_url) == []
    finally:
        admin = await asyncpg.connect(admin_url)
        await admin.execute(f'drop database if exists "{name}" with (force)')
        await admin.execute("drop role if exists bot_expenses")
        await admin.close()
