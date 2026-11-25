"""The morning brief: the card, its buttons (task numbers, habit ticks, Refresh), /brief and the daily loop."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from osbot import app, texts
from osbot.api import ApiUnreachable
from osbot.brief import BriefCb, BriefMemory, brief_keyboard, brief_once, brief_text, is_brief
from osbot.keyboards import TaskCb

from .conftest import TASK2_ID, TODAY, Tg, bot_message, buttons, fake_api

NBSP = " "
DAY = "2026-11-25"
H1 = "55555555-5555-4555-8555-555555555555"
H2 = "66666666-6666-4666-8666-666666666666"

BRIEF = {
    "date": DAY,
    "label": "Wednesday 25 Nov",
    "timezone": "Europe/Prague",
    "events": [
        {"title": "Standup", "location": "", "allDay": False, "start": "", "end": "", "time": "09:00 – 09:15"},
        {"title": "Dentist <Dr. A>", "location": "Vinohradská 1", "allDay": False, "start": "", "end": "", "time": "14:00 – 15:00"},
    ],
    "tasks": [
        {"id": TASK2_ID, "title": "Call the bank", "overdue": False, "dueDate": DAY, "time": "10:00", "url": "https://os.example/t2"},
    ],
    "tasksToday": 1,
    "overdue": 2,
    "habits": {
        "date": DAY,
        "habits": [
            {"id": H1, "name": "Stretch", "emoji": "🧘", "done": True, "current": 4},
            {"id": H2, "name": "Read", "emoji": "", "done": False, "current": 0},
        ],
        "done": 1,
        "total": 2,
        "url": "https://os.example/app/habits",
    },
    "money": {
        "currency": "CZK",
        "month": "2026-11",
        "spentMinor": 1240000,
        "limits": {"limitMinor": 800000, "spentMinor": 630000, "leftMinor": 170000},
        "near": [{"name": "Taxi", "percent": 120, "leftMinor": -20000}, {"name": "Food", "percent": 92, "leftMinor": 40000}],
        "plan": None,
        "url": "https://os.example/app/budget/limits",
    },
    "payments": {"items": [{"title": "Netflix", "amountMinor": 29900, "currency": "CZK", "subscription": True}], "url": ""},
    "clear": False,
    "delivered": False,
    "url": "https://os.example/app",
}

CLEAR = {
    **BRIEF,
    "events": [],
    "tasks": [],
    "tasksToday": 0,
    "overdue": 0,
    "habits": None,
    "payments": {"items": [], "url": ""},
    "money": {**BRIEF["money"], "limits": None, "near": [], "plan": {"monthlyContributionMinor": 1000000, "monthNetMinor": 1200000}},
    "clear": True,
}


# --- the card -------------------------------------------------------------------------------


def test_the_card_lists_the_day():
    text = brief_text(BRIEF)
    assert text.splitlines()[0] == "☀️ <b>Wednesday 25 Nov</b>"
    assert "📅 <b>Calendar</b> · 2 events" in text
    assert "<code>14:00 – 15:00</code>  Dentist &lt;Dr. A&gt; · <i>Vinohradská 1</i>" in text
    assert "✅ <b>Tasks</b> · 1 due today\n<b>1.</b> Call the bank · <i>10:00</i>" in text
    assert "⚠️ 2 tasks overdue · /today" in text
    assert "🌱 <b>Habits</b> · 1 of 2 done · tap to tick off" in text
    assert f"💳 <b>Charging today</b>: Netflix 299{NBSP}CZK" in text
    assert f"💸 <b>Spent</b> 12{NBSP}400{NBSP}CZK in November · 1{NBSP}700{NBSP}CZK left of the limits" in text
    assert f"🔴 Taxi 120 % · over by 200{NBSP}CZK" in text
    assert f"⚠️ Food 92 % · 400{NBSP}CZK left" in text
    assert text.endswith("<i>Tap a number opens a task · a habit ticks it off.</i>")
    assert is_brief(text)


def test_an_empty_day_is_a_clear_day_with_the_money_and_plan():
    text = brief_text(CLEAR)
    assert "🌤 Nothing planned — a clear day." in text
    assert "Calendar" not in text and "Tasks" not in text and "Tap" not in text
    assert f"Plan: save 10{NBSP}000{NBSP}CZK a month · so far +12{NBSP}000{NBSP}CZK ✓" in text


def test_without_budget_there_is_no_money_line():
    assert "💸" not in brief_text({**CLEAR, "money": None})


def test_the_buttons_are_task_numbers_habit_ticks_today_and_refresh():
    assert buttons(brief_keyboard(BRIEF)) == [
        ("1", TaskCb(action="open", id=TASK2_ID, page=0).pack()),
        ("✅ 🧘 Stretch · 🔥 4", f"hb:t:{H1}:{DAY}"),
        ("⬜ Read", f"hb:t:{H2}:{DAY}"),
        ("↗ Today", "https://os.example/app"),
        ("🔄 Refresh", "br:ref"),
    ]
    assert buttons(brief_keyboard({**CLEAR, "url": "http://web:3000/app"})) == [("🔄 Refresh", "br:ref")]


# --- /brief and the buttons -------------------------------------------------------------------


def brief_tg(**overrides) -> Tg:
    return Tg(fake_api(**{"brief": AsyncMock(return_value=BRIEF), "toggle_habit": AsyncMock(), "habits": AsyncMock(), **overrides}))


async def test_brief_command_and_refresh():
    tg = brief_tg()
    await tg.send("/brief")
    sent = tg.session.last("SendMessage")
    assert sent.text == brief_text(BRIEF)
    assert buttons(sent.reply_markup)[-1] == ("🔄 Refresh", "br:ref")
    await tg.press(BriefCb(action="ref").pack(), message=bot_message(brief_text(BRIEF)))
    assert tg.session.last("EditMessageText").text == brief_text(BRIEF)


async def test_brief_errors_offer_a_retry():
    tg = brief_tg(brief=AsyncMock(side_effect=ApiUnreachable("down")))
    await tg.send("/brief")
    assert buttons(tg.session.last("SendMessage").reply_markup) == [("🔄 Try again", "rt:brief:")]
    tg.api.brief = AsyncMock(return_value=CLEAR)
    await tg.press("rt:brief:", message=bot_message("error"))
    assert tg.session.last("EditMessageText").text == brief_text(CLEAR)


async def test_ticking_a_habit_on_the_brief_redraws_the_brief():
    after = {**BRIEF, "habits": {**BRIEF["habits"], "done": 2}}
    tg = brief_tg(
        toggle_habit=AsyncMock(
            return_value={
                "toggled": {"id": H2, "done": True, "name": "Read"},
                "today": DAY,
                "date": DAY,
                "habits": [{**h, "done": True} for h in BRIEF["habits"]["habits"]],
                "done": 2,
                "total": 2,
            }
        ),
        brief=AsyncMock(return_value=after),
    )
    await tg.press(f"hb:t:{H2}:{DAY}", message=bot_message(brief_text(BRIEF)))
    tg.api.toggle_habit.assert_awaited_once_with(H2, DAY)
    edited = tg.session.last("EditMessageText")
    assert edited.text == brief_text(after)
    assert tg.toast().text == "🎉 All done for the day"


async def test_a_habit_card_still_redraws_as_the_habit_card():
    card = {"date": DAY, "today": DAY, "label": "Wednesday 25 Nov", "habits": [], "done": 0, "total": 0, "url": None}
    tg = brief_tg(toggle_habit=AsyncMock(return_value={**card, "toggled": {"id": H2, "done": False, "name": "Read"}}))
    await tg.press(f"hb:t:{H2}:{DAY}", message=bot_message("🌱 Habits · Wednesday 25 Nov"))
    tg.api.brief.assert_not_awaited()
    assert tg.session.last("EditMessageText").text.startswith("🌱 <b>Habits</b>")


async def test_a_task_number_opens_the_task_card_from_today():
    tg = brief_tg()
    await tg.press(TaskCb(action="open", id=TASK2_ID, page=0).pack(), message=bot_message(brief_text(BRIEF)))
    tg.api.today.assert_awaited()
    assert tg.session.last("EditMessageText").text.startswith("☐ <b>Call the bank</b>")
    assert TODAY["tasks"][1]["id"] == TASK2_ID


async def test_brief_is_in_the_menu_and_help():
    assert "brief" in [c.command for c in app.COMMANDS]
    assert "/brief" in texts.HELP


# --- the morning loop ---------------------------------------------------------------------------


class FakeBot:
    def __init__(self, fail: bool = False):
        self.sent: list[SimpleNamespace] = []
        self.fail = fail

    async def send_message(self, chat_id, text, reply_markup=None):
        if self.fail:
            raise RuntimeError("telegram down")
        self.sent.append(SimpleNamespace(chat_id=chat_id, text=text, reply_markup=reply_markup))
        return SimpleNamespace(message_id=len(self.sent))


def loop_api(due: dict | None = None, **overrides):
    api = SimpleNamespace(
        brief_due=AsyncMock(return_value=due if due is not None else {"due": True, "date": DAY, "time": "08:00", "brief": BRIEF}),
        ack_brief=AsyncMock(return_value=1),
    )
    for name, value in overrides.items():
        setattr(api, name, value)
    return api


async def test_the_brief_is_sent_when_due_then_acked():
    bot, api = FakeBot(), loop_api()
    assert await brief_once(bot, api, 42) is True
    assert bot.sent[0].text == brief_text(BRIEF)
    assert buttons(bot.sent[0].reply_markup)[0] == ("1", TaskCb(action="open", id=TASK2_ID, page=0).pack())
    api.ack_brief.assert_awaited_once_with(DAY)


async def test_nothing_is_sent_when_not_due_or_the_app_is_down():
    bot = FakeBot()
    not_due = loop_api({"due": False, "date": DAY, "time": "08:00", "brief": None})
    assert await brief_once(bot, not_due, 42) is False
    down = loop_api(brief_due=AsyncMock(side_effect=ApiUnreachable("down")))
    assert await brief_once(bot, down, 42) is False
    assert bot.sent == []
    not_due.ack_brief.assert_not_awaited()


async def test_a_failed_send_is_not_acked_and_a_failed_ack_does_not_repeat():
    api = loop_api()
    assert await brief_once(FakeBot(fail=True), api, 42) is False
    api.ack_brief.assert_not_awaited()

    bot = FakeBot()
    api = loop_api(ack_brief=AsyncMock(side_effect=ApiUnreachable("down")))
    memory = BriefMemory()
    assert await brief_once(bot, api, 42, memory) is True
    assert await brief_once(bot, api, 42, memory) is False
    assert len(bot.sent) == 1
