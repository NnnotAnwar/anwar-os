"""Payment reminders and the weekly review: texts, scheduling, idempotency and the /week buttons."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

from osbot import digest
from osbot.api import ApiUnreachable
from osbot.digest import WeeklyMemory, money, payments_once, payments_text, review_time, week_key, weekly_once, weekly_text

from .conftest import Tg, bot_message, buttons, fake_api

CHAT = 42
NBSP = " "
NETFLIX_ID = "55555555-5555-4555-8555-555555555555"
RENT_ID = "66666666-6666-4666-8666-666666666666"

# Monday 23 Nov 2026, 10:30 in Prague (UTC+1).
MONDAY_MORNING = datetime(2026, 11, 23, 9, 30, tzinfo=UTC)
# Sunday 22 Nov 2026, 19:01 in Prague.
SUNDAY_EVENING = datetime(2026, 11, 22, 18, 1, tzinfo=UTC)

NETFLIX = {
    "key": f"{NETFLIX_ID}:2026-11-24",
    "recurringId": NETFLIX_ID,
    "title": "Netflix",
    "amountMinor": 29900,
    "currency": "CZK",
    "date": "2026-11-24",
    "subscription": True,
    "categoryName": "Subscriptions",
}
RENT = {**NETFLIX, "key": f"{RENT_ID}:2026-11-24", "recurringId": RENT_ID, "title": "Rent", "amountMinor": 1800000, "subscription": False}
DUE = {"today": "2026-11-23", "date": "2026-11-24", "items": [NETFLIX, RENT], "url": "https://os.example/app/budget/subscriptions"}

WEEKLY = {
    "week": {"start": "2026-11-16", "end": "2026-11-22", "label": "16–22 Nov", "key": "2026-11-16"},
    "nextWeek": {"start": "2026-11-23", "end": "2026-11-29", "label": "23–29 Nov"},
    "today": "2026-11-22",
    "timezone": "Europe/Prague",
    "delivered": False,
    "url": "https://os.example/app",
    "tasks": {"done": 12, "added": 9, "overdue": 2, "url": "https://os.example/app/tasks"},
    "focus": [
        {"id": "t1", "title": "Pay rent", "dueDate": "2026-11-20", "overdue": True, "url": ""},
        {"id": "t2", "title": "Call the bank", "dueDate": "2026-11-22", "overdue": False, "url": ""},
        {"id": "t3", "title": "Send invoice", "dueDate": "2026-11-25", "overdue": False, "url": ""},
    ],
    "calendar": {
        "events": [
            {"title": "Standup", "day": "Mon", "time": "10:00", "allDay": False, "start": ""},
            {"title": "Conference", "day": "Wed", "time": "all day", "allDay": True, "start": ""},
        ],
        "total": 7,
        "url": "https://os.example/app/calendar",
    },
    "spending": {
        "currency": "CZK",
        "thisWeekMinor": 482000,
        "lastWeekMinor": 548000,
        "top": [{"name": "Food", "amountMinor": 190000}, {"name": "Eating out", "amountMinor": 110000}],
        "plan": {"monthlyContributionMinor": 1000000, "monthNetMinor": 620000, "month": "2026-11"},
        "url": "https://os.example/app/budget",
    },
    "payments": {
        "items": [{"title": "Netflix", "amountMinor": 29900, "currency": "CZK", "date": "2026-11-24", "subscription": True}],
        "totals": [{"currency": "CZK", "amountMinor": 29900}],
        "url": "https://os.example/app/budget/subscriptions",
    },
    "captured": {"ideas": 3, "notes": 5, "links": 0, "feedback": 1},
}


def fake_bot(fail: bool = False):
    async def send(chat_id, text, **kwargs):
        if fail:
            raise RuntimeError("telegram down")
        return SimpleNamespace(message_id=100)

    return SimpleNamespace(send_message=AsyncMock(side_effect=send))


def digest_api(**overrides):
    api = SimpleNamespace(
        payments_due=AsyncMock(return_value=DUE),
        ack_payments=AsyncMock(return_value=2),
        weekly=AsyncMock(return_value=WEEKLY),
        ack_weekly=AsyncMock(return_value=1),
    )
    for name, value in overrides.items():
        setattr(api, name, value)
    return api


# --- formatting ---------------------------------------------------------------------


def test_money_groups_thousands_and_keeps_cents():
    assert money(124000, "CZK") == f"1{NBSP}240{NBSP}CZK"
    assert money(1550, "CZK") == f"15.50{NBSP}CZK"
    assert money(999, "EUR") == f"9.99{NBSP}EUR"
    assert money(620000, "CZK", signed=True) == f"+6{NBSP}200{NBSP}CZK"
    assert money(-5000, "CZK", signed=True) == f"−50{NBSP}CZK"


def test_one_payment_reads_as_a_notification():
    text = payments_text({**DUE, "items": [NETFLIX]})
    assert text == f"💳 <b>Tomorrow: Netflix</b> · 299{NBSP}CZK\n<i>Subscription · charges Tue 24 Nov</i>"


def test_several_payments_are_listed_with_their_total():
    assert payments_text(DUE) == (
        f"💳 <b>2 payments tomorrow</b> · 18{NBSP}299{NBSP}CZK\n"
        f"• Netflix · 299{NBSP}CZK\n"
        f"• Rent · 18{NBSP}000{NBSP}CZK"
    )


def test_payment_titles_are_escaped():
    text = payments_text({**DUE, "items": [{**NETFLIX, "title": "<b>Gym</b> & co"}]})
    assert "&lt;b&gt;Gym&lt;/b&gt; &amp; co" in text


def test_weekly_card():
    assert weekly_text(WEEKLY) == "\n".join(
        [
            "🗓 <b>Your week</b> · 16–22 Nov",
            "",
            "✅ <b>Tasks</b> · 12 done · 9 added · ⚠️ 2 overdue",
            "🎯 <b>Focus</b>: Pay rent <i>(overdue)</i> · Call the bank <i>(today)</i> · Send invoice <i>(Wed 25 Nov)</i>",
            "",
            "📅 <b>Next week</b> · 7 events",
            "<code>Mon 10:00  </code>  Standup",
            "<code>Wed all day</code>  Conference",
            "<i>+5 more</i>",
            "",
            f"💸 <b>Spent</b> 4{NBSP}820{NBSP}CZK · ▼ 12 % vs last week",
            f"Food 1{NBSP}900{NBSP}CZK · Eating out 1{NBSP}100{NBSP}CZK",
            f"Plan: save 10{NBSP}000{NBSP}CZK a month · November so far +6{NBSP}200{NBSP}CZK",
            "",
            f"💳 <b>Payments next week</b> · 299{NBSP}CZK",
            f"Tue 24 Nov · Netflix · 299{NBSP}CZK",
            "",
            "📥 <b>New this week</b> · 3 ideas · 5 notes · 1 feedback message",
        ]
    )


def test_weekly_card_leaves_out_what_is_switched_off_or_empty():
    quiet = {
        **WEEKLY,
        "tasks": None,
        "focus": [],
        "calendar": {"events": [], "total": 0, "url": ""},
        "spending": {**WEEKLY["spending"], "lastWeekMinor": 0, "top": [], "plan": None},
        "payments": {"items": [], "totals": [], "url": ""},
        "captured": {"ideas": None, "notes": 0, "links": None, "feedback": None},
    }
    assert weekly_text(quiet) == "\n".join(
        [
            "🗓 <b>Your week</b> · 16–22 Nov",
            "",
            "📅 <b>Next week</b> · <i>nothing in the calendar</i>",
            "",
            f"💸 <b>Spent</b> 4{NBSP}820{NBSP}CZK",
        ]
    )


def test_weekly_keyboards():
    assert buttons(digest.weekly_keyboard(WEEKLY, scheduled=True)) == [
        ("↗ Open in app", "https://os.example/app"),
        ("💤 1 h", "wk:snz"),
        ("⏭ Skip", "wk:skip"),
    ]
    assert buttons(digest.weekly_keyboard({**WEEKLY, "url": "http://web:3000/app"}, scheduled=False)) == [("🔄 Refresh", "wk:ref")]


# --- scheduling -----------------------------------------------------------------------


def test_review_time_is_sunday_evening_in_prague():
    assert review_time(SUNDAY_EVENING)
    assert not review_time(SUNDAY_EVENING - timedelta(minutes=2))  # 18:59 in Prague
    assert not review_time(SUNDAY_EVENING + timedelta(hours=5))  # Monday 00:01
    assert week_key(SUNDAY_EVENING) == "2026-11-16"
    assert week_key(MONDAY_MORNING) == "2026-11-23"


async def test_payments_wait_for_the_morning():
    api = digest_api()
    bot = fake_bot()
    assert await payments_once(bot, api, CHAT, MONDAY_MORNING - timedelta(hours=1)) == 0  # 09:30
    api.payments_due.assert_not_awaited()


async def test_payments_are_sent_in_one_message_then_acked():
    api = digest_api()
    bot = fake_bot()
    assert await payments_once(bot, api, CHAT, MONDAY_MORNING) == 2
    call = bot.send_message.call_args
    assert call.args == (CHAT, payments_text(DUE))
    assert buttons(call.kwargs["reply_markup"]) == [("↗ Subscriptions", DUE["url"])]
    api.ack_payments.assert_awaited_once_with([NETFLIX["key"], RENT["key"]])


async def test_payments_not_sent_are_not_acked_and_nothing_due_sends_nothing():
    api = digest_api()
    assert await payments_once(fake_bot(fail=True), api, CHAT, MONDAY_MORNING) == 0
    api.ack_payments.assert_not_awaited()

    api = digest_api(payments_due=AsyncMock(return_value={**DUE, "items": []}))
    bot = fake_bot()
    assert await payments_once(bot, api, CHAT, MONDAY_MORNING) == 0
    bot.send_message.assert_not_awaited()

    api = digest_api(payments_due=AsyncMock(side_effect=ApiUnreachable("down")))
    assert await payments_once(fake_bot(), api, CHAT, MONDAY_MORNING) == 0


async def test_weekly_review_goes_out_once_on_sunday_evening():
    api = digest_api()
    bot = fake_bot()
    memory = WeeklyMemory()
    assert not await weekly_once(bot, api, CHAT, MONDAY_MORNING, memory)
    api.weekly.assert_not_awaited()

    assert await weekly_once(bot, api, CHAT, SUNDAY_EVENING, memory)
    call = bot.send_message.call_args
    assert call.args == (CHAT, weekly_text(WEEKLY))
    assert [b[0] for b in buttons(call.kwargs["reply_markup"])] == ["↗ Open in app", "💤 1 h", "⏭ Skip"]
    api.ack_weekly.assert_awaited_once_with("2026-11-16")

    # A minute later: remembered, no second call.
    assert not await weekly_once(bot, api, CHAT, SUNDAY_EVENING + timedelta(minutes=1), memory)
    assert api.weekly.await_count == 1


async def test_weekly_review_is_not_repeated_after_a_restart():
    api = digest_api(weekly=AsyncMock(return_value={**WEEKLY, "delivered": True}))
    bot = fake_bot()
    memory = WeeklyMemory()  # a fresh process
    assert not await weekly_once(bot, api, CHAT, SUNDAY_EVENING, memory)
    bot.send_message.assert_not_awaited()
    assert memory.sent_week == "2026-11-16"
    assert not await weekly_once(bot, api, CHAT, SUNDAY_EVENING + timedelta(minutes=1), memory)
    assert api.weekly.await_count == 1


async def test_a_weekly_review_that_failed_to_send_is_retried():
    api = digest_api()
    memory = WeeklyMemory()
    assert not await weekly_once(fake_bot(fail=True), api, CHAT, SUNDAY_EVENING, memory)
    api.ack_weekly.assert_not_awaited()
    assert memory.sent_week is None
    assert await weekly_once(fake_bot(), api, CHAT, SUNDAY_EVENING + timedelta(minutes=1), memory)


async def test_a_snoozed_review_comes_back_once():
    api = digest_api()
    bot = fake_bot()
    memory = WeeklyMemory(sent_week="2026-11-16")
    memory.snooze(SUNDAY_EVENING + timedelta(hours=1))
    assert not await weekly_once(bot, api, CHAT, SUNDAY_EVENING + timedelta(minutes=30), memory)
    assert await weekly_once(bot, api, CHAT, SUNDAY_EVENING + timedelta(hours=1), memory)
    assert bot.send_message.call_args.args[1].endswith("<i>💤 Snoozed</i>")
    assert not await weekly_once(bot, api, CHAT, SUNDAY_EVENING + timedelta(hours=1, minutes=1), memory)
    api.ack_weekly.assert_not_awaited()


# --- /week and the card's buttons ---------------------------------------------------------


def week_tg(**overrides) -> Tg:
    return Tg(fake_api(weekly=AsyncMock(return_value=WEEKLY), **overrides))


async def test_week_command_shows_the_review_with_refresh():
    tg = week_tg(ack_weekly=AsyncMock())
    await tg.send("/week")
    sent = tg.session.last("SendMessage")
    assert sent.text == weekly_text(WEEKLY)
    assert buttons(sent.reply_markup) == [("↗ Open in app", "https://os.example/app"), ("🔄 Refresh", "wk:ref")]
    tg.api.ack_weekly.assert_not_awaited()  # on demand: never marks the Sunday review as sent


async def test_week_errors_are_retryable():
    tg = week_tg()
    tg.api.weekly = AsyncMock(side_effect=ApiUnreachable("down"))
    await tg.send("/week")
    sent = tg.session.last("SendMessage")
    assert buttons(sent.reply_markup) == [("🔄 Try again", "rt:week:")]
    tg.api.weekly = AsyncMock(return_value=WEEKLY)
    await tg.press("rt:week:", message=bot_message("error"))
    assert tg.session.last("EditMessageText").text == weekly_text(WEEKLY)


async def test_snooze_and_skip_buttons():
    tg = week_tg()
    card = bot_message(weekly_text(WEEKLY), reply_markup=digest.weekly_keyboard(WEEKLY, scheduled=True).model_dump(exclude_none=True))
    await tg.press("wk:snz", message=card)
    memory: WeeklyMemory = tg.dp["weekly"]
    assert memory.snoozed_until is not None
    edited = tg.session.last("EditMessageText")
    assert "<i>💤 Snoozed until" in edited.text
    assert buttons(edited.reply_markup) == [("↗ Open in app", "https://os.example/app")]
    assert tg.toast().text.startswith("💤 I'll send it again at")

    await tg.press("wk:skip", message=card)
    assert tg.session.last("EditMessageText").text.endswith("<i>⏭ Skipped</i>")
    assert tg.toast().text == "⏭ Skipped. See you next Sunday."


async def test_refresh_edits_the_card_in_place():
    tg = week_tg()
    await tg.press("wk:ref", message=bot_message("old"))
    assert tg.session.last("EditMessageText").text == weekly_text(WEEKLY)
    tg.api.weekly.assert_awaited_once_with()
