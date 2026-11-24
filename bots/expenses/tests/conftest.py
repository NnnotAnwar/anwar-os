"""Fixtures: a fake Budget API on localhost (tests/fake_budget.py) and a real client for it.

Nothing here touches Telegram, the real web app or a database.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from expenses_bot.api import BudgetApi

from .fake_budget import SECRET, FakeBudget

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
