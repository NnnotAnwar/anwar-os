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
    note: str | None = None,
) -> int:
    """Insert an expense and return its id. Creates the user row if it is missing."""
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            "insert into bot_expenses.users (telegram_id) values ($1) on conflict do nothing",
            telegram_id,
        )
        return await conn.fetchval(
            """
            insert into bot_expenses.expenses (telegram_user_id, amount_minor, currency, category, note)
            values ($1, $2, $3, $4, $5)
            returning id
            """,
            telegram_id,
            amount_minor,
            currency,
            category,
            note,
        )


_EXPENSE_COLUMNS = "id, amount_minor, currency, category, note, created_at"


async def get_expense(pool: asyncpg.Pool, telegram_id: int, expense_id: int) -> asyncpg.Record | None:
    """One of the user's expenses (created_at is timestamptz), or None if missing / not theirs."""
    return await pool.fetchrow(
        f"select {_EXPENSE_COLUMNS} from bot_expenses.expenses where id = $2 and telegram_user_id = $1",
        telegram_id,
        expense_id,
    )


async def update_expense(
    pool: asyncpg.Pool,
    telegram_id: int,
    expense_id: int,
    *,
    amount_minor: int | None = None,
    category: str | None = None,
    note: str | None = None,
    clear_note: bool = False,
) -> asyncpg.Record | None:
    """Change the given fields of one of the user's expenses; return the updated row."""
    return await pool.fetchrow(
        f"""
        update bot_expenses.expenses
           set amount_minor = coalesce($3, amount_minor),
               category     = coalesce($4, category),
               note         = case when $6 then null else coalesce($5, note) end
         where id = $2 and telegram_user_id = $1
        returning {_EXPENSE_COLUMNS}
        """,
        telegram_id,
        expense_id,
        amount_minor,
        category,
        note,
        clear_note,
    )


async def delete_expense(pool: asyncpg.Pool, telegram_id: int, expense_id: int) -> asyncpg.Record | None:
    """Delete one of the user's expenses; return the deleted row (None if it was not there)."""
    return await pool.fetchrow(
        f"""
        delete from bot_expenses.expenses where id = $2 and telegram_user_id = $1
        returning {_EXPENSE_COLUMNS}
        """,
        telegram_id,
        expense_id,
    )


async def list_expenses(
    pool: asyncpg.Pool, telegram_id: int, limit: int, offset: int = 0
) -> tuple[list[asyncpg.Record], int]:
    """A page of the user's expenses, newest first, and the user's total number of expenses."""
    async with pool.acquire() as conn:
        total = await conn.fetchval(
            "select count(*) from bot_expenses.expenses where telegram_user_id = $1", telegram_id
        )
        rows = await conn.fetch(
            f"""
            select {_EXPENSE_COLUMNS} from bot_expenses.expenses
            where telegram_user_id = $1
            order by created_at desc, id desc
            limit $2 offset $3
            """,
            telegram_id,
            limit,
            offset,
        )
    return rows, total


async def expenses_between(
    pool: asyncpg.Pool, telegram_id: int, start: datetime, end: datetime
) -> list[asyncpg.Record]:
    """The user's expenses in [start, end), oldest first."""
    return await pool.fetch(
        f"""
        select {_EXPENSE_COLUMNS} from bot_expenses.expenses
        where telegram_user_id = $1 and created_at >= $2 and created_at < $3
        order by created_at, id
        """,
        telegram_id,
        start,
        end,
    )


async def category_totals(
    pool: asyncpg.Pool, telegram_id: int, start: datetime, end: datetime
) -> list[asyncpg.Record]:
    """Per (category, currency) in [start, end): total_minor and count, largest first."""
    return await pool.fetch(
        """
        select category, currency, sum(amount_minor)::bigint as total_minor, count(*)::int as n
        from bot_expenses.expenses
        where telegram_user_id = $1 and created_at >= $2 and created_at < $3
        group by category, currency
        order by total_minor desc, category
        """,
        telegram_id,
        start,
        end,
    )


async def currency_totals(
    pool: asyncpg.Pool, telegram_id: int, start: datetime, end: datetime
) -> dict[str, int]:
    rows = await pool.fetch(
        """
        select currency, sum(amount_minor)::bigint as total_minor
        from bot_expenses.expenses
        where telegram_user_id = $1 and created_at >= $2 and created_at < $3
        group by currency
        """,
        telegram_id,
        start,
        end,
    )
    return {r["currency"]: r["total_minor"] for r in rows}


async def frequent_categories(pool: asyncpg.Pool, telegram_id: int, days: int = 90) -> list[str]:
    """Categories the user picked in the last `days` days, most used (then most recent) first."""
    rows = await pool.fetch(
        """
        select category from bot_expenses.expenses
        where telegram_user_id = $1 and created_at >= now() - make_interval(days => $2)
        group by category
        order by count(*) desc, max(created_at) desc
        """,
        telegram_id,
        days,
    )
    return [r["category"] for r in rows]


async def known_categories(pool: asyncpg.Pool, telegram_id: int) -> list[str]:
    """Every category name the user has ever used."""
    rows = await pool.fetch(
        "select distinct category from bot_expenses.expenses where telegram_user_id = $1",
        telegram_id,
    )
    return [r["category"] for r in rows]


async def category_for_note(pool: asyncpg.Pool, telegram_id: int, note: str) -> str | None:
    """The category the user filed this exact note under most often (case-insensitive)."""
    return await pool.fetchval(
        """
        select category from bot_expenses.expenses
        where telegram_user_id = $1 and note is not null and lower(note) = lower($2)
        group by category
        order by count(*) desc, max(created_at) desc
        limit 1
        """,
        telegram_id,
        note,
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
