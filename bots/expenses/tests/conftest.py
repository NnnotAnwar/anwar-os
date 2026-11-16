"""Fixtures for the Postgres-backed tests.

Needs a throwaway Postgres 17 you are allowed to wreck (roles are created and dropped):

    docker run --rm -d --name expenses-pg-test -p 55499:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine
    export TEST_DATABASE_URL=postgresql://postgres:test@localhost:55499/postgres
    export TEST_PSQL="docker exec -i expenses-pg-test psql -U postgres"   # or a local psql
    uv run pytest

TEST_PSQL is a psql command (connected as superuser, without -d) used to run
db/bootstrap.sql exactly as in production. Without TEST_DATABASE_URL the database
tests are skipped; the pure unit tests still run.
"""

from __future__ import annotations

import os
import secrets
import shlex
import subprocess
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest

from expenses_bot import db

ROOT = Path(__file__).resolve().parent.parent
BOOTSTRAP_SQL = ROOT / "db" / "bootstrap.sql"
BOT_PASSWORD = "test-" + secrets.token_hex(8)

ADMIN_URL = os.environ.get("TEST_DATABASE_URL")
PSQL = os.environ.get("TEST_PSQL", "psql")

needs_db = pytest.mark.skipif(not ADMIN_URL, reason="TEST_DATABASE_URL not set")


def with_db(url: str, *, dbname: str, user: str | None = None, password: str | None = None) -> str:
    parts = urlsplit(url)
    host = parts.hostname or "localhost"
    port = f":{parts.port}" if parts.port else ""
    user = user or parts.username or ""
    password = password if password is not None else (parts.password or "")
    auth = f"{user}:{password}@" if password else (f"{user}@" if user else "")
    return urlunsplit((parts.scheme, f"{auth}{host}{port}", f"/{dbname}", "", ""))


def run_bootstrap(dbname: str) -> subprocess.CompletedProcess[str]:
    cmd = [*shlex.split(PSQL), "-X", "-q", "-d", dbname, "-v", "ON_ERROR_STOP=1", "-v", f"bot_password={BOT_PASSWORD}", "-f", "-"]
    result = subprocess.run(cmd, input=BOOTSTRAP_SQL.read_text(), capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        raise RuntimeError(f"bootstrap failed ({result.returncode}): {result.stderr}")
    return result


class DbInfo:
    def __init__(self, name: str, admin_url: str, bot_url: str, first_bootstrap_stderr: str):
        self.name = name
        self.admin_url = admin_url
        self.bot_url = bot_url
        self.first_bootstrap_stderr = first_bootstrap_stderr


@pytest.fixture(scope="session")
async def test_db():
    if not ADMIN_URL:
        pytest.skip("TEST_DATABASE_URL not set")
    name = "expenses_test_" + secrets.token_hex(4)
    admin = await asyncpg.connect(ADMIN_URL)
    try:
        if await admin.fetchval("select 1 from pg_roles where rolname = 'os_app'"):
            raise RuntimeError("role os_app already exists; use a fresh throwaway Postgres")
        await admin.execute(f'create database "{name}"')
    finally:
        await admin.close()

    # First run happens before os_app exists (the guard must skip its grants).
    first = run_bootstrap(name)
    run_bootstrap(name)  # re-runnable
    tdb = DbInfo(
        name,
        admin_url=with_db(ADMIN_URL, dbname=name),
        bot_url=with_db(ADMIN_URL, dbname=name, user="bot_expenses", password=BOT_PASSWORD),
        first_bootstrap_stderr=first.stderr,
    )
    try:
        yield tdb
    finally:
        admin = await asyncpg.connect(ADMIN_URL)
        try:
            await admin.execute(f'drop database if exists "{name}" with (force)')
            await admin.execute("drop role if exists os_app")
            await admin.execute("drop role if exists bot_expenses")
        finally:
            await admin.close()


@pytest.fixture(scope="session")
async def pool(test_db):
    """Pool connected as the bot role, with migrations applied (as the bot does at startup)."""
    p = await db.create_pool(test_db.bot_url)
    try:
        yield p
    finally:
        await p.close()


@pytest.fixture(scope="session")
async def migrated(pool):
    return await db.migrate(pool)


@pytest.fixture
async def clean(pool, migrated):
    await pool.execute(
        "truncate bot_expenses.expenses, bot_expenses.activity_daily, bot_expenses.heartbeat,"
        " bot_expenses.users restart identity"
    )
    return pool
