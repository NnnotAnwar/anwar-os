"""Fixtures: a fake Budget API on localhost (tests/fake_budget.py) and a real client for it.

Nothing here touches Telegram, the real web app or a database. The one test that reads
the bot's old Postgres schema (test_import.py) needs TEST_DATABASE_URL (a throwaway
Postgres) and TEST_PSQL, and is skipped without them:

    docker run --rm -d --name expenses-pg-test -p 55499:5432 -e POSTGRES_PASSWORD=test postgres:17-alpine
    export TEST_DATABASE_URL=postgresql://postgres:test@localhost:55499/postgres
    export TEST_PSQL="docker exec -i expenses-pg-test psql -U postgres"
    uv run pytest
"""

from __future__ import annotations

import os
from types import SimpleNamespace

import pytest

from expenses_bot.api import BudgetApi

from .fake_budget import SECRET, FakeBudget

needs_db = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")


@pytest.fixture
async def budget():
    """`budget.fake` is the in-memory Budget, `budget.api` the bot's client pointed at it."""
    fake = FakeBudget()
    server = await fake.start()
    api = BudgetApi(str(server.make_url("")).rstrip("/"), SECRET)
    try:
        yield SimpleNamespace(fake=fake, api=api, server=server)
    finally:
        await api.close()
        await server.close()
