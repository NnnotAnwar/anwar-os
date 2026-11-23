"""BudgetApi against the fake web app (signatures checked), errors, config."""

from __future__ import annotations

from datetime import UTC, date, datetime

import pytest

from expenses_bot.api import ApiError, ApiUnreachable, BudgetApi, Draft, Saved, parse_expense
from expenses_bot.config import ConfigError, load_config
from expenses_bot.errors import describe
from expenses_bot.periods import today_local

from .fake_budget import PREFIX


async def test_every_call_is_signed_and_parsed(budget):
    api, fake = budget.api, budget.fake
    setup = await api.setup()
    assert setup.currency == "CZK" and setup.default_account_id == fake.account_id
    assert [c.name for c in setup.categories][:2] == ["Eating out", "Education"]  # no usage yet: by name

    saved = await api.quick("250 food lunch")
    assert isinstance(saved, Saved)
    assert (saved.expense["amount_minor"], saved.expense["category"], saved.expense["note"]) == (25000, "Food", "lunch")
    assert saved.expense["timed"] and saved.totals.day == {"CZK": 25000}

    draft = await api.quick("89.90 mystery")
    assert draft == Draft(amount_minor=8990, note="mystery", occurred_on=today_local(), currency="CZK")

    created = await api.create(1550, fake.category_id("Health"), "pills")
    assert created.expense["category"] == "Health"
    updated = await api.update(created.expense["id"], amount_minor=2000, note="")
    assert (updated.expense["amount_minor"], updated.expense["note"]) == (2000, None)
    assert (await api.get(created.expense["id"])).expense["amount_minor"] == 2000
    rows, total = await api.recent(1)
    assert total == 2 and len(rows) == 1
    assert len(await api.between(today_local(), today_local())) == 2
    removed = await api.delete(created.expense["id"])
    assert removed.expense["id"] == created.expense["id"]
    await api.heartbeat("v9", datetime(2026, 11, 23, 8, 0, tzinfo=UTC))
    assert fake.beats == [{"version": "v9", "startedAt": "2026-11-23T08:00:00+00:00"}]

    assert fake.unsigned == 0
    assert {c["path"] for c in fake.calls} >= {
        f"{PREFIX}/setup",
        f"{PREFIX}/expenses/quick",
        f"{PREFIX}/expenses",
        f"{PREFIX}/expense",
        f"{PREFIX}/expense/update",
        f"{PREFIX}/expense/delete",
        f"{PREFIX}/expenses/recent",
        f"{PREFIX}/expenses/range",
        f"{PREFIX}/heartbeat",
    }


async def test_setup_is_cached_and_writes_reorder_it(budget):
    api, fake = budget.api, budget.fake
    await api.setup()
    await api.setup()
    assert sum(c["path"].endswith("/setup") for c in fake.calls) == 1
    await api.create(100, fake.category_id("Travel"), "")
    assert (await api.setup()).categories[0].name == "Travel"
    assert sum(c["path"].endswith("/setup") for c in fake.calls) == 2


async def test_errors_carry_the_web_apps_message(budget):
    api, fake = budget.api, budget.fake
    with pytest.raises(ApiError) as gone:
        await api.get("11111111-1111-4111-8111-111111111111")
    assert gone.value.gone and "doesn't exist" in gone.value.message
    fake.fail["/expenses/quick"] = (422, {"error": "not_expense", "message": "The bot logs spending."})
    with pytest.raises(ApiError) as refused:
        await api.quick("+500")
    assert describe(refused.value).title == "✋ The bot logs spending."


async def test_a_wrong_secret_is_refused(budget):
    async with BudgetApi(str(budget.server.make_url("")), "x" * 40) as api:
        with pytest.raises(ApiError) as exc:
            await api.setup()
    assert exc.value.status == 401
    assert describe(exc.value).kind == "auth"


async def test_no_answer_at_all_is_unreachable():
    async with BudgetApi("http://127.0.0.1:9", "x" * 40) as api:
        with pytest.raises(ApiUnreachable):
            await api.setup()
        # The help text still has a currency to show.
        assert await api.currency() == "CZK"


def test_problem_kinds():
    assert describe(ApiUnreachable("x")).kind == "unreachable"
    assert describe(ApiError(404, "not_found")).kind == "disabled"
    assert describe(ApiError(404, "error")).kind == "outdated"
    assert describe(ApiError(404, "gone", "Gone.")).kind == "gone"
    assert describe(ApiError(503, "no_owner")).kind == "auth"
    assert describe(ApiError(500, "internal")).kind == "server"
    assert len(describe(ApiError(400, "invalid_input", "x" * 300)).toast()) <= 200


def test_expense_time_is_shown_only_when_recorded_that_day():
    same_day = parse_expense(
        {"id": "a", "amountMinor": 100, "currency": "CZK", "categoryId": None, "categoryName": None, "note": "",
         "occurredOn": "2026-11-22", "recordedAt": "2026-11-22T08:15:00.000Z", "accountId": "x", "accountName": "Main"}
    )
    assert same_day["timed"] and same_day["when"] == datetime(2026, 11, 22, 8, 15, tzinfo=UTC)
    assert same_day["category"] == "Uncategorised" and same_day["note"] is None
    backdated = parse_expense({**_raw(), "occurredOn": "2026-11-20", "recordedAt": "2026-11-22T08:15:00Z"})
    assert not backdated["timed"]
    assert backdated["when"].date() == date(2026, 11, 20) and backdated["when"].hour == 0


def _raw():
    return {"id": "a", "amountMinor": 100, "currency": "CZK", "categoryId": None, "categoryName": "Food", "note": "x",
            "accountId": "x", "accountName": "Main"}


def test_config_requires_api_secret_and_owner():
    env = {
        "BOT_TOKEN": "1:x",
        "BOT_EXPENSES_API_URL": "http://web:3000/",
        "BOT_EXPENSES_API_SECRET": "s" * 32,
        "BOT_EXPENSES_OWNER_ID": "42",
    }
    config = load_config(env)
    assert (config.api_url, config.owner_id, config.version) == ("http://web:3000", 42, "dev")
    assert "s" * 32 not in repr(config) and "1:x" not in repr(config)
    for name in env:
        with pytest.raises(ConfigError, match=name):
            load_config({**env, name: ""})
    with pytest.raises(ConfigError, match="at least 32"):
        load_config({**env, "BOT_EXPENSES_API_SECRET": "short"})
    with pytest.raises(ConfigError, match="number"):
        load_config({**env, "BOT_EXPENSES_OWNER_ID": "@anwar"})
    assert load_config({**env, "BOT_TOKEN": ""}, require_token=False).bot_token == ""

