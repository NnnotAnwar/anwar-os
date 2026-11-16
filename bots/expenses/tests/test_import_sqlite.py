"""The one-off SQLite importer, with a synthetic expenses.db in a temp dir."""

from __future__ import annotations

import sqlite3
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

import import_sqlite
from import_sqlite import amount_to_minor, import_sqlite as run_import, parse_legacy_date

from .conftest import needs_db

PRAGUE = ZoneInfo("Europe/Prague")


@pytest.mark.parametrize(
    ("value", "expected"),
    [(15.5, 1550), (50.0, 5000), (0.1, 10), (19.99, 1999), (0.30000000000000004, 30), (15.555, 1556), ("12,30", 1230), (7, 700)],
)
def test_amount_to_minor(value, expected):
    assert amount_to_minor(value) == expected


@pytest.mark.parametrize("value", [None, 0, 0.004, -5.0, float("nan"), float("inf"), "abc", True])
def test_amount_to_minor_rejects(value):
    with pytest.raises(ValueError):
        amount_to_minor(value)


def test_parse_legacy_date():
    # The old bot stored str(datetime.now()) via sqlite3's default adapter.
    assert parse_legacy_date("2026-03-24 18:05:09.123456", PRAGUE) == datetime(2026, 3, 24, 18, 5, 9, 123456, tzinfo=PRAGUE)
    assert parse_legacy_date("2026-03-24 18:05:09", PRAGUE) == datetime(2026, 3, 24, 18, 5, 9, tzinfo=PRAGUE)
    with pytest.raises(ValueError):
        parse_legacy_date("yesterday", PRAGUE)
    with pytest.raises(ValueError):
        parse_legacy_date(None, PRAGUE)


def make_legacy_db(path):
    """Same DDL the old bot's init_db() created."""
    conn = sqlite3.connect(path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            amount REAL,
            category TEXT,
            date TIMESTAMP
        )
        """
    )
    rows = [
        (111, 15.5, "Food", "2026-03-01 12:00:00.000001"),
        (111, 0.1, "Transport", "2026-03-02 08:30:00.5"),
        (111, 19.99, "Food", "2026-03-24 23:59:59.999999"),
        (222, 1200.0, "Utilities", "2026-03-10 10:00:00"),
        (222, -5.0, "Food", "2026-03-11 10:00:00"),  # skipped: not positive
        (None, 10.0, "Food", "2026-03-12 10:00:00"),  # skipped: no user
        (222, 10.0, "Food", "not a date"),  # skipped: bad date
        (222, 3.0, None, "2026-03-13 10:00:00"),  # category falls back to Other
    ]
    conn.executemany("INSERT INTO expenses (user_id, amount, category, date) VALUES (?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()


async def test_dry_run_reads_without_database(tmp_path):
    path = tmp_path / "expenses.db"
    make_legacy_db(path)
    report = await run_import(path, "postgresql://unused", dry_run=True)
    assert report.read == 8
    assert len(report.skipped) == 3
    assert report.inserted == 0


@needs_db
async def test_import_and_reimport(tmp_path, clean, test_db):
    pool = clean
    path = tmp_path / "expenses.db"
    make_legacy_db(path)
    before = path.read_bytes()

    report = await run_import(path, test_db.bot_url)
    assert (report.read, report.inserted, report.already_imported, report.users) == (8, 5, 0, 2)
    assert sorted(reason.split(" ")[0] for _, reason in report.skipped) == ["amount", "no", "unparsable"]

    rows = await pool.fetch(
        "select telegram_user_id, amount_minor, currency, category, created_at, external_ref"
        " from bot_expenses.expenses order by external_ref"
    )
    by_ref = {r["external_ref"]: r for r in rows}
    assert by_ref["sqlite:1"]["amount_minor"] == 1550
    assert by_ref["sqlite:2"]["amount_minor"] == 10
    assert by_ref["sqlite:3"]["amount_minor"] == 1999
    assert by_ref["sqlite:4"]["amount_minor"] == 120000
    assert by_ref["sqlite:8"]["category"] == "Other"
    assert {r["currency"] for r in rows} == {"CZK"}
    # Naive local 12:00 in Prague (CET, UTC+1 on 1 March) is 11:00 UTC.
    assert by_ref["sqlite:1"]["created_at"] == datetime(2026, 3, 1, 11, 0, 0, 1, tzinfo=ZoneInfo("UTC"))

    users = {r["telegram_id"]: r for r in await pool.fetch("select * from bot_expenses.users")}
    assert set(users) == {111, 222}
    assert users[111]["first_seen"] == by_ref["sqlite:1"]["created_at"]
    assert users[111]["last_seen"] == by_ref["sqlite:3"]["created_at"]

    again = await run_import(path, test_db.bot_url)
    assert (again.inserted, again.already_imported) == (0, 5)
    assert await pool.fetchval("select count(*) from bot_expenses.expenses") == 5
    assert path.read_bytes() == before  # source file untouched


@needs_db
async def test_import_currency_option(tmp_path, clean, test_db):
    path = tmp_path / "expenses.db"
    make_legacy_db(path)
    await run_import(path, test_db.bot_url, currency="EUR")
    assert {r["currency"] for r in await clean.fetch("select currency from bot_expenses.expenses")} == {"EUR"}


def test_cli_rejects_missing_database_url(tmp_path, monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    with pytest.raises(SystemExit):
        import_sqlite.main([str(tmp_path / "expenses.db")])
    assert "DATABASE_URL" in capsys.readouterr().err
