"""Schema, migrations, roles and repository functions against a real Postgres."""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import asyncpg
import pytest

from expenses_bot import db, repo
from expenses_bot.heartbeat import beat_once
from expenses_bot.middleware import SeenUsersMiddleware

from .conftest import needs_db

pytestmark = needs_db


async def test_bootstrap_guard_without_os_app(test_db):
    assert "os_app does not exist yet" in test_db.first_bootstrap_stderr


async def test_migrations_are_applied_once(pool, migrated):
    assert migrated == ["0001_init"]
    assert await db.migrate(pool) == []
    versions = await pool.fetch("select version from bot_expenses.schema_migrations")
    assert [r["version"] for r in versions] == ["0001_init"]


async def test_os_app_gets_read_only_stats_access(test_db, pool, migrated):
    admin = await asyncpg.connect(test_db.admin_url)
    try:
        await admin.execute("create role os_app nologin")
        # The bot re-applies the grants at every startup.
        assert await db.migrate(pool) == []
        async with admin.transaction():
            await admin.execute("set local role os_app")
            row = await admin.fetchrow("select * from bot_expenses.stats_overview")
            assert row["total_users"] >= 0
            await admin.fetch("select * from bot_expenses.stats_daily")
        for table in ("expenses", "users", "heartbeat", "activity_daily"):
            with pytest.raises(asyncpg.InsufficientPrivilegeError):
                async with admin.transaction():
                    await admin.execute("set local role os_app")
                    await admin.fetch(f"select * from bot_expenses.{table}")
        with pytest.raises(asyncpg.InsufficientPrivilegeError):
            async with admin.transaction():
                await admin.execute("set local role os_app")
                await admin.execute("insert into bot_expenses.users (telegram_id) values (1)")
    finally:
        await admin.close()


async def test_bot_role_is_confined_to_its_schema(pool, migrated):
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await pool.execute("create table public.sneaky (id int)")
    with pytest.raises(asyncpg.InsufficientPrivilegeError):
        await pool.execute("create schema sneaky")
    role = await pool.fetchrow(
        "select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = current_user"
    )
    assert not any(role.values())


async def test_add_expense_creates_user_and_lists_newest_first(clean):
    pool = clean
    for i, amount in enumerate([100, 200, 300, 400, 500, 600]):
        await repo.add_expense(pool, 42, amount, f"Cat{i}")
    await repo.add_expense(pool, 7, 999, "Food")

    recent = await repo.get_recent_expenses(pool, 42)
    assert [r["amount_minor"] for r in recent] == [600, 500, 400, 300, 200]
    assert {r["currency"] for r in recent} == {"CZK"}
    assert recent[0]["created_at"].tzinfo is None  # local Prague time for display
    assert await pool.fetchval("select count(*) from bot_expenses.users") == 2


async def test_expense_constraints(clean):
    pool = clean
    with pytest.raises(asyncpg.CheckViolationError):
        await repo.add_expense(pool, 1, 0, "Food")
    with pytest.raises(asyncpg.CheckViolationError):
        await repo.add_expense(pool, 1, 100, "Food", currency="czk")


async def _insert_at(pool, user_id, amount, category, at, currency="CZK"):
    await pool.execute(
        "insert into bot_expenses.users (telegram_id) values ($1) on conflict do nothing", user_id
    )
    await pool.execute(
        "insert into bot_expenses.expenses (telegram_user_id, amount_minor, currency, category, created_at)"
        " values ($1, $2, $3, $4, $5)",
        user_id, amount, currency, category, at,
    )


async def test_monthly_stats_uses_prague_month_boundaries(clean):
    pool = clean
    # 2026-10-31 23:30 UTC is already 2026-11-01 00:30 in Prague -> November.
    await _insert_at(pool, 1, 1000, "Food", datetime(2026, 10, 31, 23, 30, tzinfo=UTC))
    # 2026-10-31 22:30 UTC is 23:30 in Prague -> October.
    await _insert_at(pool, 1, 5000, "Food", datetime(2026, 10, 31, 22, 30, tzinfo=UTC))
    await _insert_at(pool, 1, 250, "Food", datetime(2026, 11, 10, 12, 0, tzinfo=UTC))
    await _insert_at(pool, 1, 300, "Transport", datetime(2026, 11, 15, 12, 0, tzinfo=UTC))
    await _insert_at(pool, 1, 700, "Transport", datetime(2026, 11, 15, 13, 0, tzinfo=UTC), currency="EUR")
    await _insert_at(pool, 2, 9999, "Food", datetime(2026, 11, 15, 12, 0, tzinfo=UTC))  # other user
    await _insert_at(pool, 1, 8888, "Food", datetime(2026, 12, 1, 0, 30, tzinfo=UTC))  # December

    stats = await repo.get_monthly_stats(pool, 1, at=datetime(2026, 11, 16, 9, 0, tzinfo=UTC))
    got = {(r["category"], r["currency"]): r["total_minor"] for r in stats}
    assert got == {("Food", "CZK"): 1250, ("Transport", "CZK"): 300, ("Transport", "EUR"): 700}


async def test_touch_user_counts_activity(clean):
    pool = clean
    await repo.touch_user(pool, 5, "old_name")
    await repo.touch_user(pool, 5, "new_name")
    await repo.touch_user(pool, 6, None)
    user = await pool.fetchrow("select * from bot_expenses.users where telegram_id = 5")
    assert user["username"] == "new_name"
    assert user["last_seen"] >= user["first_seen"]
    rows = await pool.fetch("select telegram_user_id, updates from bot_expenses.activity_daily order by 1")
    assert [(r["telegram_user_id"], r["updates"]) for r in rows] == [(5, 2), (6, 1)]


async def test_stats_views(clean):
    pool = clean
    now = datetime.now(UTC)
    await repo.touch_user(pool, 1, "a")
    await repo.touch_user(pool, 1, "a")
    await repo.touch_user(pool, 2, "b")
    await repo.add_expense(pool, 1, 1550, "Food")
    await repo.add_expense(pool, 2, 450, "Food")
    await repo.add_expense(pool, 2, 1000, "Health", currency="EUR")
    # An old expense from an inactive user, 40 days ago.
    await _insert_at(pool, 3, 100, "Other", now - timedelta(days=40))
    await pool.execute(
        "update bot_expenses.users set first_seen = $1, last_seen = $1 where telegram_id = 3",
        now - timedelta(days=40),
    )

    today = await pool.fetchrow(
        "select * from bot_expenses.stats_daily where day = (now() at time zone 'Europe/Prague')::date"
    )
    assert today["messages"] == 3
    assert today["active_users"] == 2
    assert today["expenses"] == 3
    assert json.loads(today["amounts_minor"]) == {"CZK": 2000, "EUR": 1000}

    old = await pool.fetchrow(
        "select * from bot_expenses.stats_daily where day < (now() at time zone 'Europe/Prague')::date"
    )
    assert (old["messages"], old["active_users"], old["expenses"]) == (0, 0, 1)

    overview = await pool.fetchrow("select * from bot_expenses.stats_overview")
    assert overview["total_users"] == 3
    assert overview["active_users_7d"] == 2
    assert overview["active_users_30d"] == 2
    assert overview["total_expenses"] == 4
    assert json.loads(overview["total_amounts_minor"]) == {"CZK": 2100, "EUR": 1000}
    assert overview["last_heartbeat_at"] is None


async def test_heartbeat_keeps_a_single_row(clean, tmp_path):
    pool = clean
    started = datetime.now(UTC)
    health_file = tmp_path / "alive"
    assert await beat_once(pool, "expenses", "abc123", started, health_file)
    first = await pool.fetchrow("select * from bot_expenses.heartbeat")
    await asyncio.sleep(0.01)
    assert await beat_once(pool, "expenses", "abc123", started, health_file)
    rows = await pool.fetch("select * from bot_expenses.heartbeat")
    assert len(rows) == 1
    assert rows[0]["bot_name"] == "expenses"
    assert rows[0]["version"] == "abc123"
    assert rows[0]["last_beat_at"] > first["last_beat_at"]
    assert health_file.exists()
    overview = await pool.fetchrow("select last_heartbeat_at, bot_version from bot_expenses.stats_overview")
    assert overview["bot_version"] == "abc123"
    assert overview["last_heartbeat_at"] == rows[0]["last_beat_at"]
    with pytest.raises(asyncpg.CheckViolationError):
        await pool.execute(
            "insert into bot_expenses.heartbeat (id, bot_name, started_at, last_beat_at) values (2, 'x', now(), now())"
        )


async def test_seen_users_middleware_records_and_never_blocks(clean):
    pool = clean
    mw = SeenUsersMiddleware()
    calls = []

    async def handler(event, data):
        calls.append(event)
        return "handled"

    user = SimpleNamespace(id=77, username="someone", is_bot=False)
    assert await mw(handler, "update", {"event_from_user": user, "pool": pool}) == "handled"
    assert await pool.fetchval("select username from bot_expenses.users where telegram_id = 77") == "someone"

    # A broken pool must not stop the handler from running.
    broken = SimpleNamespace(execute=None)
    assert await mw(handler, "update2", {"event_from_user": user, "pool": broken}) == "handled"
    assert calls == ["update", "update2"]
