"""Habits: the /habits card, toggling from buttons, reminders and the evening nudge."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import SendMessage

from osbot import app, texts
from osbot.api import ApiError, ApiUnreachable
from osbot.habits import HabitCb, habits_keyboard, habits_once, habits_text, reminders_text

from .conftest import Tg, bot_message, buttons, fake_api

H1 = "55555555-5555-4555-8555-555555555555"
H2 = "66666666-6666-4666-8666-666666666666"
DAY = "2026-11-24"

CARD = {
    "date": DAY,
    "today": DAY,
    "label": "Tuesday 24 Nov",
    "habits": [
        {"id": H1, "name": "Stretch", "emoji": "🧘", "done": True, "current": 4},
        {"id": H2, "name": "Read <20> min", "emoji": "", "done": False, "current": 0},
    ],
    "done": 1,
    "total": 2,
    "url": "https://os.example/app/habits",
}


def card_with(**changes):
    return {**CARD, **changes}


# --- texts and keyboards -------------------------------------------------------------------


def test_card_counts_and_escapes():
    assert habits_text(CARD) == "🌱 <b>Habits</b> · Tuesday 24 Nov\n1 of 2 done · tap to tick one off"
    assert habits_text(card_with(done=2)) == "🌱 <b>Habits</b> · Tuesday 24 Nov\n🎉 All 2 done. Nice."
    assert "Nothing scheduled" in habits_text(card_with(habits=[], done=0, total=0))


def test_card_buttons_toggle_each_habit_on_its_day():
    assert buttons(habits_keyboard(CARD)) == [
        ("✅ 🧘 Stretch · 🔥 4", f"hb:t:{H1}:{DAY}"),
        ("⬜ Read <20> min", f"hb:t:{H2}:{DAY}"),
        ("↗ Open in app", "https://os.example/app/habits"),
        ("🔄 Refresh", f"hb:r::{DAY}"),
    ]
    # Telegram allows 64 bytes of callback data.
    assert len(HabitCb(action="t", id=H1, d=DAY).pack().encode()) <= 64


def test_reminder_texts():
    one = [{"id": H1, "name": "Stretch", "emoji": "🧘", "time": "07:00"}]
    assert reminders_text(one) == "⏰ <b>Time for 🧘 Stretch</b>\n<i>Your reminder at 07:00</i>"
    two = one + [{"id": H2, "name": "A & B", "emoji": "", "time": "08:30"}]
    assert reminders_text(two) == "⏰ <b>Habit reminders</b>\n• 🧘 Stretch · 07:00\n• A &amp; B · 08:30"


# --- /habits and its buttons ----------------------------------------------------------------


def habits_tg(**overrides) -> Tg:
    return Tg(fake_api(**{"habits": AsyncMock(return_value=CARD), "toggle_habit": AsyncMock(), **overrides}))


async def test_habits_command_shows_the_card():
    tg = habits_tg()
    await tg.send("/habits")
    sent = tg.session.last("SendMessage")
    assert sent.text == habits_text(CARD)
    assert buttons(sent.reply_markup)[0] == ("✅ 🧘 Stretch · 🔥 4", f"hb:t:{H1}:{DAY}")


async def test_habits_errors_are_retryable():
    tg = habits_tg()
    tg.api.habits = AsyncMock(side_effect=ApiUnreachable("down"))
    await tg.send("/habits")
    assert buttons(tg.session.last("SendMessage").reply_markup) == [("🔄 Try again", "rt:habits:")]
    tg.api.habits = AsyncMock(return_value=CARD)
    await tg.press("rt:habits:", message=bot_message("error"))
    assert tg.session.last("EditMessageText").text == habits_text(CARD)


async def test_tapping_a_habit_toggles_it_and_redraws_the_card():
    done = card_with(
        habits=[CARD["habits"][0], {**CARD["habits"][1], "done": True, "current": 3}],
        done=2,
        toggled={"id": H2, "done": True, "name": "Read"},
    )
    tg = habits_tg(toggle_habit=AsyncMock(return_value=done))
    await tg.press(f"hb:t:{H2}:{DAY}")
    tg.api.toggle_habit.assert_awaited_once_with(H2, DAY)
    edited = tg.session.last("EditMessageText")
    assert edited.text == habits_text(done)
    assert buttons(edited.reply_markup)[1] == ("✅ Read <20> min · 🔥 3", f"hb:t:{H2}:{DAY}")
    assert tg.toast().text == "🎉 All done for the day"


async def test_toasts_for_a_streak_and_for_unticking():
    streak = card_with(
        habits=[{**CARD["habits"][0], "current": 5}, CARD["habits"][1]], toggled={"id": H1, "done": True, "name": "Stretch"}
    )
    tg = habits_tg(toggle_habit=AsyncMock(return_value=streak))
    await tg.press(f"hb:t:{H1}:{DAY}")
    assert tg.toast().text == "✅ Done · 🔥 5"
    tg.api.toggle_habit = AsyncMock(return_value=card_with(toggled={"id": H1, "done": False, "name": "Stretch"}))
    await tg.press(f"hb:t:{H1}:{DAY}")
    assert tg.toast().text == "↩ Not done"


async def test_a_refused_toggle_explains_why():
    tg = habits_tg(toggle_habit=AsyncMock(side_effect=ApiError(422, "not_changed", "This habit is archived. Restore it to check it off.")))
    await tg.press(f"hb:t:{H1}:{DAY}")
    toast = tg.toast()
    assert toast.show_alert is True
    assert "archived" in toast.text
    assert not tg.session.of("EditMessageText")


async def test_refresh_reloads_the_cards_own_day():
    tg = habits_tg()
    await tg.press("hb:r::2026-11-23")
    tg.api.habits.assert_awaited_once_with("2026-11-23")
    assert tg.session.last("EditMessageText").text == habits_text(CARD)


async def test_habits_is_in_the_menu_and_help():
    assert "habits" in [c.command for c in app.COMMANDS]
    assert "/habits" in texts.HELP


# --- nudges ---------------------------------------------------------------------------------


class FakeBot:
    def __init__(self, fail: bool = False):
        self.sent: list[SendMessage] = []
        self.fail = fail

    async def send_message(self, chat_id, text, reply_markup=None):
        if self.fail:
            raise TelegramBadRequest(method=SendMessage(chat_id=chat_id, text=text), message="chat not found")
        self.sent.append(SimpleNamespace(chat_id=chat_id, text=text, reply_markup=reply_markup))
        return self.sent[-1]


NUDGES = {
    "date": DAY,
    "reminders": [{"id": H1, "name": "Stretch", "emoji": "🧘", "time": "07:00"}],
    "evening": {"time": "21:00", "habits": [{"id": H2, "name": "Read", "emoji": "📚", "done": False, "current": 2}]},
    "url": "https://os.example/app/habits",
}


async def test_reminders_and_the_evening_nudge_are_sent_then_acked():
    bot = FakeBot()
    api = SimpleNamespace(habit_nudges=AsyncMock(return_value=NUDGES), ack_habit_nudges=AsyncMock(return_value=2))
    assert await habits_once(bot, api, 42) == 2
    reminder, evening = bot.sent
    assert reminder.text == reminders_text(NUDGES["reminders"])
    assert buttons(reminder.reply_markup) == [("⬜ 🧘 Stretch", f"hb:t:{H1}:{DAY}"), ("↗ Habits", "https://os.example/app/habits")]
    assert evening.text.startswith("🌙 <b>Still open today</b> · 1\n📚 Read")
    assert buttons(evening.reply_markup)[0] == ("⬜ 📚 Read · 🔥 2", f"hb:t:{H2}:{DAY}")
    api.ack_habit_nudges.assert_awaited_once_with(DAY, [H1], True)


async def test_nothing_due_sends_nothing():
    bot = FakeBot()
    api = SimpleNamespace(
        habit_nudges=AsyncMock(return_value={"date": DAY, "reminders": [], "evening": None, "url": None}), ack_habit_nudges=AsyncMock()
    )
    assert await habits_once(bot, api, 42) == 0
    assert bot.sent == []
    api.ack_habit_nudges.assert_not_awaited()


async def test_unsent_nudges_are_not_acked_and_the_app_being_down_is_quiet():
    api = SimpleNamespace(habit_nudges=AsyncMock(return_value=NUDGES), ack_habit_nudges=AsyncMock())
    assert await habits_once(FakeBot(fail=True), api, 42) == 0
    api.ack_habit_nudges.assert_not_awaited()
    down = SimpleNamespace(habit_nudges=AsyncMock(side_effect=ApiUnreachable("down")), ack_habit_nudges=AsyncMock())
    assert await habits_once(FakeBot(), down, 42) == 0


async def test_a_failing_ack_does_not_repeat_the_message_every_minute():
    bot = FakeBot()
    api = SimpleNamespace(habit_nudges=AsyncMock(return_value=NUDGES), ack_habit_nudges=AsyncMock(side_effect=ApiUnreachable("down")))
    sent: set[str] = set()
    assert await habits_once(bot, api, 42, sent) == 2
    assert await habits_once(bot, api, 42, sent) == 0
    assert len(bot.sent) == 2
