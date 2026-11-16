"""Data access for the bot_expenses schema."""

from __future__ import annotations

from datetime import datetime

import asyncpg

from .config import DEFAULT_CURRENCY, TIMEZONE


async def touch_user(pool: asyncpg.Pool, telegram_id: int, username: str | None) -> None:
    """Record that a user interacted with the bot (users.last_seen + daily counter)."""
    await pool.execute(
        """
        with u as (
          insert into bot_expenses.users (telegram_id, username)
          values ($1, $2)
          on conflict (telegram_id) do update
            set last_seen = now(), username = excluded.username
          returning telegram_id
        )
        insert into bot_expenses.activity_daily (day, telegram_user_id, updates)
        select (now() at time zone $3)::date, telegram_id, 1 from u
        on conflict (day, telegram_user_id) do update
          set updates = bot_expenses.activity_daily.updates + 1
        """,
        telegram_id,
        username,
        TIMEZONE,
    )


async def add_expense(
    pool: asyncpg.Pool,
    telegram_id: int,
    amount_minor: int,
    category: str,
    currency: str = DEFAULT_CURRENCY,
) -> int:
    """Insert an expense and return its id. Creates the user row if it is missing."""
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "insert into bot_expenses.users (telegram_id) values ($1) on conflict do nothing",
            telegram_id,
        )
        return await conn.fetchval(
            """
            insert into bot_expenses.expenses (telegram_user_id, amount_minor, currency, category)
            values ($1, $2, $3, $4)
            returning id
            """,
            telegram_id,
            amount_minor,
            currency,
            category,
        )


async def get_recent_expenses(pool: asyncpg.Pool, telegram_id: int, limit: int = 5) -> list[asyncpg.Record]:
    """Newest first: amount_minor, currency, category, created_at (in TIMEZONE, naive)."""
    return await pool.fetch(
        """
        select amount_minor, currency, category,
               created_at at time zone $3 as created_at
        from bot_expenses.expenses
        where telegram_user_id = $1
        order by created_at desc, id desc
        limit $2
        """,
        telegram_id,
        limit,
        TIMEZONE,
    )


async def get_monthly_stats(
    pool: asyncpg.Pool, telegram_id: int, at: datetime | None = None
) -> list[asyncpg.Record]:
    """Totals per (category, currency) for the calendar month containing `at` (default: now)."""
    return await pool.fetch(
        """
        with bounds as (
          select date_trunc('month', coalesce($2::timestamptz, now()) at time zone $3) as start_local
        )
        select category, currency, sum(amount_minor)::bigint as total_minor
        from bot_expenses.expenses, bounds
        where telegram_user_id = $1
          and created_at >= (start_local at time zone $3)
          and created_at <  ((start_local + interval '1 month') at time zone $3)
        group by category, currency
        order by total_minor desc, category
        """,
        telegram_id,
        at,
        TIMEZONE,
    )


async def beat(pool: asyncpg.Pool, bot_name: str, version: str, started_at: datetime) -> None:
    """Upsert the single heartbeat row."""
    await pool.execute(
        """
        insert into bot_expenses.heartbeat (id, bot_name, version, started_at, last_beat_at)
        values (1, $1, $2, $3, now())
        on conflict (id) do update
          set bot_name = excluded.bot_name,
              version = excluded.version,
              started_at = excluded.started_at,
              last_beat_at = excluded.last_beat_at
        """,
        bot_name,
        version,
        started_at,
    )
