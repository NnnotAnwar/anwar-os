"""Monthly limits: the "left" line under a saved expense, and the /limits card (text, buttons, command)."""

from __future__ import annotations

from expenses_bot import profile, render
from expenses_bot.api import ApiError, Limit
from expenses_bot.handlers import expense
from expenses_bot.handlers import limits as handler
from expenses_bot.limits import LimitsCb, bar, limits_keyboard, limits_text

from .tg import button_data, button_texts, fake_callback, fake_message, last_markup, last_text, new_state

NBSP = "\u00a0"


def limit(left: int, *, status: str = "ok", percent: int = 50, cap: int = 600000, name: str = "Food") -> Limit:
    return Limit(name=name, limit_minor=cap, spent_minor=cap - left, left_minor=left, percent=percent, status=status, currency="CZK")


def test_limit_line_says_what_is_left_and_warns_when_close_or_over():
    assert render.limit_line(limit(80000)) == f"🎯 Food · 800{NBSP}CZK left of 6{NBSP}000{NBSP}CZK"
    assert render.limit_line(limit(30000, status="near", percent=95)) == f"⚠️ <b>Food</b> · 300{NBSP}CZK left of 6{NBSP}000{NBSP}CZK · 95 %"
    assert render.limit_line(limit(-130000, status="over", percent=121)) == f"🔴 <b>Food</b> · over by 1{NBSP}300{NBSP}CZK · limit 6{NBSP}000{NBSP}CZK"
    assert render.limit_line(limit(0, status="over", percent=100)) == f"🔴 <b>Food</b> · limit used up (6{NBSP}000{NBSP}CZK)"
    assert "&lt;b&gt;" in render.limit_line(limit(100, name="<b>Fun</b>"))


def item(name: str, spent: int, cap: int, *, status: str = "ok", pace: int | None = None) -> dict:
    return {
        "categoryId": f"id-{name}",
        "name": name,
        "limitMinor": cap,
        "spentMinor": spent,
        "leftMinor": cap - spent,
        "percent": spent * 100 // cap,
        "status": status,
        "paceMinor": pace,
        "currency": "CZK",
        "month": "2026-11",
    }


DATA = {
    "month": "2026-11",
    "today": "2026-11-24",
    "currency": "CZK",
    "items": [
        item("Eating out", 330000, 300000, status="over"),
        item("Fun", 95000, 100000, status="near"),
        item("Food", 400000, 600000, pace=650000),
    ],
    "url": "https://anwar-os.com/app/budget/limits",
}


def test_bar_fills_to_the_share_used():
    assert bar(0, 1000) == "▱" * 10
    assert bar(1, 1000) == "▰" + "▱" * 9  # something spent always shows
    assert bar(500, 1000) == "▰" * 5 + "▱" * 5
    assert bar(5000, 1000) == "▰" * 10


def test_card_lists_limits_fullest_first_with_bars():
    assert limits_text(DATA) == "\n".join(
        [
            "🎯 <b>Limits · November</b>",
            f"<i>8{NBSP}250{NBSP}CZK of 10{NBSP}000{NBSP}CZK · 1 over · 1 close</i>",
            "",
            f"🔴 <b>Eating out</b> · 3{NBSP}300{NBSP}CZK of 3{NBSP}000{NBSP}CZK",
            f"<code>▰▰▰▰▰▰▰▰▰▰</code> 110 % · over by 300{NBSP}CZK",
            "",
            f"🟠 <b>Fun</b> · 950{NBSP}CZK of 1{NBSP}000{NBSP}CZK",
            f"<code>▰▰▰▰▰▰▰▰▰▰</code> 95 % · 50{NBSP}CZK left",
            "",
            f"🟢 <b>Food</b> · 4{NBSP}000{NBSP}CZK of 6{NBSP}000{NBSP}CZK",
            f"<code>▰▰▰▰▰▰▰▱▱▱</code> 66 % · 2{NBSP}000{NBSP}CZK left",
            f"<i>On pace for 6{NBSP}500{NBSP}CZK this month</i>",
        ]
    )


def test_card_without_limits_says_where_to_set_them():
    text = limits_text({**DATA, "items": []})
    assert text.startswith("🎯 <b>No limits yet</b>\nSet a monthly limit for a category in Budget → Limits")


def test_keyboard_has_refresh_and_a_public_link_only():
    assert button_texts(limits_keyboard(DATA)) == [["🔄 Refresh", "↗ Open in Budget"]]
    assert button_data(limits_keyboard(DATA))[0] == LimitsCb().pack()
    assert button_texts(limits_keyboard({**DATA, "url": "http://web:3000/app/budget/limits"})) == [["🔄 Refresh"]]


async def test_command_reads_budget_and_shows_the_card(budget):
    budget.fake.limits = {"Food": 600000}
    budget.fake.add(450000, "Food")
    message = fake_message("/limits")
    await handler.cmd_limits(message, new_state(), budget.api)
    call = budget.fake.calls[-1]
    assert (call["method"], call["path"]) == ("GET", "/api/internal/budget-bot/limits")
    text = last_text(message.answer)
    assert text.startswith("🎯 <b>Limits · ")
    assert f"🟢 <b>Food</b> · 4{NBSP}500{NBSP}CZK of 6{NBSP}000{NBSP}CZK" in text
    assert button_texts(last_markup(message.answer)) == [["🔄 Refresh"]]


async def test_refresh_edits_the_card(budget):
    callback = fake_callback(LimitsCb().pack())
    await handler.on_refresh(callback, budget.api)
    assert callback.message.edit_text.call_args.args[0].startswith("🎯 <b>No limits yet</b>")
    callback.answer.assert_awaited_once()


async def test_failures_reach_the_error_handler(budget):
    budget.fake.fail["/limits"] = (500, {"error": "internal"})
    try:
        await handler.cmd_limits(fake_message("/limits"), new_state(), budget.api)
    except ApiError as error:
        assert error.status == 500
    else:  # pragma: no cover
        raise AssertionError("expected the API error to propagate to on_error")


async def test_a_saved_expense_shows_what_is_left_of_its_limit(budget):
    budget.fake.limits = {"Food": 600000}
    budget.fake.add(560000, "Food")
    message = fake_message("700 food lunch")
    await expense.quick_entry(message, new_state(), budget.api)
    text = last_text(message.answer)
    assert text.startswith("✅ <b>Saved</b>")
    assert f"🔴 <b>Food</b> · over by 300{NBSP}CZK · limit 6{NBSP}000{NBSP}CZK" in text
    # The limit line sits above the running totals.
    assert text.index("over by") < text.index("<i>Today")

    # A category without a limit: no line.
    other = fake_message("120 transport bus")
    await expense.quick_entry(other, new_state(), budget.api)
    assert "left of" not in last_text(other.answer) and "over by" not in last_text(other.answer)


def test_command_is_in_the_menu_and_help():
    assert "limits" in [c.command for c in profile.COMMANDS]
    assert "/limits" in render.help_text()
