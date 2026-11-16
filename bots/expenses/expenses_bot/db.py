"""Connection pool and the startup migration runner."""

from __future__ import annotations

import logging
from pathlib import Path

import asyncpg

from .config import MIGRATIONS_DIR

log = logging.getLogger(__name__)

SCHEMA = "bot_expenses"
# Arbitrary constant: serializes concurrent migration runs (e.g. two containers).
_MIGRATION_LOCK_KEY = 0x6578_7065  # "expe"


async def create_pool(database_url: str) -> asyncpg.Pool:
    return await asyncpg.create_pool(
        database_url,
        min_size=1,
        max_size=4,
        command_timeout=15,
        server_settings={"application_name": "bot-expenses", "search_path": SCHEMA},
    )


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    return sorted(p for p in directory.glob("*.sql") if p.is_file())


async def migrate(pool: asyncpg.Pool, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply pending migrations in filename order; return the versions applied.

    Each file runs in its own transaction and is recorded in schema_migrations, so a
    re-run is a no-op. Afterwards the stats-view grants for os_app are re-applied.
    """
    applied_now: list[str] = []
    async with pool.acquire() as conn:
        await conn.execute("select pg_advisory_lock($1)", _MIGRATION_LOCK_KEY)
        try:
            await conn.execute(
                f"""
                create table if not exists {SCHEMA}.schema_migrations (
                  version    text primary key,
                  applied_at timestamptz not null default now()
                )
                """
            )
            done = {r["version"] for r in await conn.fetch(f"select version from {SCHEMA}.schema_migrations")}
            for path in migration_files(directory):
                version = path.stem
                if version in done:
                    continue
                log.info("applying migration", extra={"version": version})
                async with conn.transaction():
                    await conn.execute(path.read_text(encoding="utf-8"))
                    await conn.execute(
                        f"insert into {SCHEMA}.schema_migrations (version) values ($1)", version
                    )
                applied_now.append(version)
            granted = await conn.fetchval(f"select {SCHEMA}.grant_stats_access()")
            if not granted:
                log.warning("role os_app does not exist; stats views are not shared with the web app yet")
        finally:
            await conn.execute("select pg_advisory_unlock($1)", _MIGRATION_LOCK_KEY)
    return applied_now
