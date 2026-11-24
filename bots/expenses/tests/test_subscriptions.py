"""/subscriptions: the card's text, its buttons, and the command against the fake Budget API."""

from __future__ import annotations

from datetime import date

from expenses_bot import profile, render
from expenses_bot.api import ApiError
from expenses_bot.handlers import subscriptions as handler
from expenses_bot.subscriptions import SubscriptionsCb, subscriptions_keyboard, subscriptions_text

from .tg import button_data, button_texts, fake_callback, fake_message, last_markup, last_text, new_state

NBSP = " "
TODAY = date(2026, 11, 23)


def item(title: str, amount: int, *, cadence: str = "Every month", next_charge: str | None = "2026-11-24", subscription: bool = True, active: bool = True, monthly: int | None = None, currency: str = "CZK"):
    return {
        "id": f"id-{title}",
        "title": title,
        "amountMinor": amount,
        "currency": currency,
        "cadence": cadence,
        "nextCharge": next_charge,
        "monthlyMinor": amount if monthly is None else monthly,
        "yearlyMinor": (amount if monthly is None else monthly) * 12,
        "subscription": subscription,
        "active": active,
        "categoryName": "Subscriptions",
    }


DATA = {
    "today": TODAY.isoformat(),
    "currency": "CZK",
    "items": [
        item("Netflix", 29900),
        item("Spotify", 16900, next_charge="2026-11-23"),
        item("Domain", 35000, cadence="Every year", next_charge="2027-03-03", monthly=2917),
        item("Rent", 1800000, subscription=False, next_charge="2026-12-01"),
        item("Gym", 99000, active=False, next_charge=None),
    ],
    "subscriptions": [{"currency": "CZK", "monthlyMinor": 49717, "yearlyMinor": 596600, "count": 3}],
    "allRecurring": [{"currency": "CZK", "monthlyMinor": 1849717, "yearlyMinor": 22196600, "count": 4}],
    "url": "https://anwar-os.com/app/budget/subscriptions",
}


def test_card_lists_subscriptions_with_cost_and_next_charge():
    assert subscriptions_text(DATA) == "\n".join(
        [
            f"🔁 <b>Subscriptions cost 497.17{NBSP}CZK a month</b> · 5{NBSP}966{NBSP}CZK a year",
            "",
            f"<b>Netflix</b> · 299{NBSP}CZK every month · <i>charges tomorrow</i>",
            f"<b>Spotify</b> · 169{NBSP}CZK every month · <i>charges today</i>",
            f"<b>Domain</b> · 350{NBSP}CZK every year (≈ 29.17{NBSP}CZK a month) · <i>next 3 Mar 2027</i>",
            f"⏸ <s>Gym</s> · 990{NBSP}CZK · <i>paused</i>",
            "",
            f"Other recurring payments: 1 · 18{NBSP}000{NBSP}CZK a month <i>(Rent)</i>",
        ]
    )


def test_card_without_subscriptions_says_where_to_add_them():
    text = subscriptions_text({**DATA, "items": [], "subscriptions": [], "allRecurring": []})
    assert text.startswith("🔁 <b>No subscriptions yet</b>\nAdd them in Budget → Subscriptions")


def test_titles_are_escaped_and_other_currencies_mentioned():
    data = {
        **DATA,
        "items": [item("<i>Tea</i> & co", 1000)],
        "subscriptions": [
            {"currency": "CZK", "monthlyMinor": 1000, "yearlyMinor": 12000, "count": 1},
            {"currency": "EUR", "monthlyMinor": 999, "yearlyMinor": 11988, "count": 1},
        ],
    }
    text = subscriptions_text(data)
    assert "&lt;i&gt;Tea&lt;/i&gt; &amp; co" in text
    assert f"<i>also 9.99{NBSP}EUR a month in EUR</i>" in text


def test_keyboard_has_refresh_and_a_public_link_only():
    assert button_texts(subscriptions_keyboard(DATA)) == [["🔄 Refresh", "↗ Open in Budget"]]
    assert button_data(subscriptions_keyboard(DATA))[0] == SubscriptionsCb().pack()
    # The stack-internal address can't be a Telegram URL button.
    assert button_texts(subscriptions_keyboard({**DATA, "url": "http://web:3000/app/budget/subscriptions"})) == [["🔄 Refresh"]]


async def test_command_reads_budget_and_shows_the_card(budget):
    budget.fake.recurring = {k: v for k, v in DATA.items() if k != "today"}
    message = fake_message("/subscriptions")
    await handler.cmd_subscriptions(message, new_state(), budget.api)
    call = budget.fake.calls[-1]
    assert (call["method"], call["path"]) == ("GET", "/api/internal/budget-bot/subscriptions")
    assert last_text(message.answer).startswith(f"🔁 <b>Subscriptions cost 497.17{NBSP}CZK a month</b>")
    assert button_texts(last_markup(message.answer)) == [["🔄 Refresh", "↗ Open in Budget"]]


async def test_refresh_edits_the_card(budget):
    callback = fake_callback(SubscriptionsCb().pack())
    await handler.on_refresh(callback, budget.api)
    assert callback.message.edit_text.call_args.args[0].startswith("🔁 <b>No subscriptions yet</b>")
    callback.answer.assert_awaited_once()


async def test_failures_reach_the_error_handler(budget):
    budget.fake.fail["/subscriptions"] = (500, {"error": "internal"})
    try:
        await handler.cmd_subscriptions(fake_message("/subscriptions"), new_state(), budget.api)
    except ApiError as error:
        assert error.status == 500
    else:  # pragma: no cover
        raise AssertionError("expected the API error to propagate to on_error")


def test_command_is_in_the_menu_and_help():
    assert "subscriptions" in [c.command for c in profile.COMMANDS]
    assert "/subscriptions" in render.help_text()
