"""Handler tests with mocked Telegram objects and the fake Budget API (tests/fake_budget.py)."""

from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import EditMessageText

from expenses_bot import categories, keyboards, profile, render
from expenses_bot.api import ApiError, ApiUnreachable
from expenses_bot.handlers import commands, entries, expense, fallback
from expenses_bot.handlers.common import Flow, put_draft
from expenses_bot.keyboards import EntryCb, PickCb
from expenses_bot.periods import today_local
from expenses_bot.ui import show

from .tg import fake_callback, fake_message, last_text, new_state


def pick(fake, name: str, amount: int = 1550, note: bool = False) -> PickCb:
    return PickCb(cat=categories.token(fake.category_id(name)), amount=amount, note=note)


async def test_start_shows_welcome_and_menu():
    message, state = fake_message("/start"), new_state()
    await state.set_state(Flow.edit_amount)
    await commands.cmd_start(message, state)
    assert "<code>250 coffee</code>" in last_text(message.answer)
    assert message.answer.call_args.kwargs["reply_markup"].is_persistent
    assert await state.get_state() is None


async def test_help_says_where_expenses_go(budget):
    message = fake_message("/help")
    await commands.cmd_help(message, new_state(), budget.api)
    assert "Budget on anwar.os (CZK" in last_text(message.answer)


async def test_unparsable_text_gets_a_hint_without_calling_budget(budget):
    message = fake_message("hello there")
    await expense.quick_entry(message, new_state(), budget.api)
    assert last_text(message.answer) == render.unknown_text()
    assert budget.fake.calls == []


async def test_add_flow_rejects_non_text(budget):
    message, state = fake_message(None), new_state()  # e.g. a sticker
    await state.set_state(Flow.amount)
    await expense.process_amount(message, state, budget.api)
    assert "doesn't look like an amount" in last_text(message.answer)
    assert await state.get_state() == Flow.amount.state


async def test_amount_only_opens_picker_with_frequent_first(budget):
    fake = budget.fake
    fake.add(100, "Health")
    message, state = fake_message("250"), new_state()
    await expense.quick_entry(message, state, budget.api)
    assert last_text(message.answer) == "💸 <b>250 CZK</b>\nPick a category:"
    markup = message.answer.call_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[0][0].text == "💊 Health"
    assert "📦 Other" in [b.text for row in markup.inline_keyboard for b in row]
    assert markup.inline_keyboard[-1][0].text == "✖ Cancel"
    drafts = (await state.get_data())["drafts"]
    assert list(drafts.values()) == [{"a": 25000, "n": None, "d": today_local().isoformat()}]


async def test_entry_is_sent_to_budget_amount_first(budget):
    for text, sent in [("coffee 250", "250 coffee"), ("15,50 kč tram", "15.50 tram"), ("1250", "1250")]:
        await expense.quick_entry(fake_message(text), new_state(), budget.api)
        quick = [c for c in budget.fake.calls if c["path"].endswith("/expenses/quick")]
        assert quick[-1]["body"]["text"] == sent


async def test_category_word_saves_directly(budget):
    message = fake_message("250 food lunch")
    await expense.quick_entry(message, new_state(), budget.api)
    (row,) = budget.fake.expenses()
    assert (row.amount_minor, budget.fake.categories[row.category_id], row.note) == (-25000, "Food", "lunch")
    text = last_text(message.answer)
    assert text.startswith("✅ <b>Saved</b>") and "🍔 Food" in text and "📝 lunch" in text
    assert "<i>Today 250 CZK" in text


async def test_learned_note_saves_directly(budget):
    budget.fake.add(500, "Eating out", "coffee")
    message = fake_message("90 Coffee")
    await expense.quick_entry(message, new_state(), budget.api)
    assert "🍽 Eating out" in last_text(message.answer)


async def test_budget_down_is_reported_and_nothing_is_lost_silently(budget):
    budget.fake.fail["/expenses/quick"] = (500, {"error": "internal"})
    message = fake_message("250 food")
    await expense.quick_entry(message, new_state(), budget.api)
    assert "Something broke on anwar.os" in last_text(message.answer)


async def test_picker_double_tap_saves_once(budget):
    fake, state = budget.fake, new_state()
    await put_draft(state, 500, 1550, "coffee")
    data = pick(fake, "Food", note=True)
    first = fake_callback(data.pack(), message_id=500)
    await expense.process_category(first, data, state, budget.api)
    second = fake_callback(data.pack(), message_id=500)
    await expense.process_category(second, data, state, budget.api)
    assert [(t.amount_minor, t.note) for t in fake.expenses()] == [(-1550, "coffee")]
    first.answer.assert_awaited_once_with("Saved")
    second.answer.assert_awaited_once_with("Already saved.")


async def test_picker_keeps_the_parsed_day(budget):
    state = new_state()
    await put_draft(state, 503, 900, None, "2026-11-01")
    data = pick(budget.fake, "Food", amount=900)
    await expense.process_category(fake_callback(data.pack(), message_id=503), data, state, budget.api)
    assert budget.fake.expenses()[0].occurred_on == date(2026, 11, 1)


async def test_picker_after_restart(budget):
    fake = budget.fake
    # Without a note the button carries everything needed.
    plain = pick(fake, "Food")
    await expense.process_category(fake_callback(plain.pack()), plain, new_state(), budget.api)
    assert [t.amount_minor for t in fake.expenses()] == [-1550]
    # With a note the draft is gone: say so instead of saving without it.
    noted = pick(fake, "Food", note=True)
    callback = fake_callback(noted.pack())
    await expense.process_category(callback, noted, new_state(), budget.api)
    assert "expired" in callback.answer.call_args.args[0]
    assert len(fake.expenses()) == 1


async def test_picker_restores_draft_when_save_fails(budget):
    budget.fake.fail["/expenses"] = (500, {"error": "internal"})
    state = new_state()
    await put_draft(state, 501, 1550, None)
    data = pick(budget.fake, "Food")
    callback = fake_callback(data.pack(), message_id=501)
    await expense.process_category(callback, data, state, budget.api)
    saved = await state.get_data()
    assert saved["drafts"] == {"501": {"a": 1550, "n": None, "d": None}}
    assert 501 not in saved["used"]
    assert callback.answer.call_args.kwargs["show_alert"] is True
    assert "Something broke" in callback.answer.call_args.args[0]
    callback.message.edit_text.assert_not_awaited()


async def test_picker_with_a_deleted_category_is_stale(budget):
    state = new_state()
    await put_draft(state, 504, 1550, None)
    data = PickCb(cat="deadbeef", amount=1550, note=False)
    callback = fake_callback(data.pack(), message_id=504)
    await expense.process_category(callback, data, state, budget.api)
    assert callback.answer.call_args.args[0] == render.stale()
    assert "504" in (await state.get_data())["drafts"]


async def test_picker_cancel(budget):
    state = new_state()
    await put_draft(state, 502, 1550, None)
    data = PickCb(cat="x", amount=0, note=False)
    callback = fake_callback(data.pack(), message_id=502)
    await expense.process_category(callback, data, state, budget.api)
    assert "Cancelled" in callback.message.edit_text.call_args.args[0]
    assert (await state.get_data())["drafts"] == {}


async def test_missing_expense_is_answered(budget):
    data = EntryCb(action="a", id="1" * 32, origin="s")
    callback = fake_callback(data.pack())
    state = new_state()
    await entries.on_entry(callback, data, state, budget.api)
    callback.answer.assert_awaited_once_with(entries.GONE, show_alert=True)
    assert await state.get_state() is None


async def test_buttons_from_the_database_days_are_stale(budget):
    old = "ex:u:17:s:"  # numeric ids of bot_expenses.expenses
    callback = fake_callback(old)
    await entries.on_entry(callback, EntryCb.unpack(old), new_state(), budget.api)
    callback.answer.assert_awaited_once_with(render.stale(), show_alert=True)
    assert budget.fake.calls == []


async def test_stale_and_legacy_buttons_are_answered():
    legacy = fake_callback("category_Food")
    await fallback.stale_category(legacy)
    assert "older version" in legacy.answer.call_args.args[0]
    unknown = fake_callback("zz:1")
    await fallback.stale_button(unknown)
    assert "expired" in unknown.answer.call_args.args[0]


async def test_bad_period_button_is_answered():
    callback = fake_callback("ov:m20991301")
    await commands.on_period(callback, keyboards.PeriodCb(p="m20991301"), object())
    callback.answer.assert_awaited_once()
    callback.message.edit_text.assert_not_awaited()


async def test_show_ignores_not_modified_and_falls_back_to_new_message():
    method = EditMessageText(text="x")
    callback = fake_callback("x")
    callback.message.edit_text.side_effect = TelegramBadRequest(method, "Bad Request: message is not modified")
    await show(callback, "same")
    callback.bot.send_message.assert_not_awaited()

    callback.message.edit_text.side_effect = TelegramBadRequest(method, "Bad Request: message can't be edited")
    await show(callback, "new")
    callback.bot.send_message.assert_awaited_once_with(42, "new", reply_markup=None)


async def test_error_handler_tells_the_owner():
    callback = fake_callback("x")
    event = SimpleNamespace(exception=RuntimeError("boom"), update=SimpleNamespace(callback_query=callback, message=None))
    assert await fallback.on_error(event) is True
    callback.answer.assert_awaited_once_with(fallback.OOPS, show_alert=True)

    message = fake_message("250")
    event = SimpleNamespace(exception=RuntimeError("boom"), update=SimpleNamespace(callback_query=None, message=message))
    await fallback.on_error(event)
    assert last_text(message.answer) == fallback.OOPS

    # A failed Budget call says what failed.
    message = fake_message("/month")
    event = SimpleNamespace(exception=ApiUnreachable("refused"), update=SimpleNamespace(callback_query=None, message=message))
    await fallback.on_error(event)
    assert "anwar.os isn't answering" in last_text(message.answer)
    callback = fake_callback("x")
    event = SimpleNamespace(exception=ApiError(401, "unauthorized"), update=SimpleNamespace(callback_query=callback, message=None))
    await fallback.on_error(event)
    assert "refused my signature" in callback.answer.call_args.args[0]


async def test_export_csv_format():
    rows = [
        {"amount_minor": 125050, "currency": "CZK", "category": "Food", "note": 'say "hi", ok', "timed": True,
         "occurred_on": date(2026, 11, 22), "when": datetime(2026, 11, 22, 8, 15, tzinfo=UTC)},
        {"amount_minor": 25000, "currency": "CZK", "category": "Žrádlo", "note": None, "timed": False,
         "occurred_on": date(2026, 11, 21), "when": datetime(2026, 11, 20, 23, 0, tzinfo=UTC)},
    ]
    data = commands.build_csv(rows).decode("utf-8-sig").splitlines()
    assert data == [
        "date,time,amount,currency,category,note",
        '2026-11-22,09:15,1250.50,CZK,Food,"say ""hi"", ok"',
        "2026-11-21,,250.00,CZK,Žrádlo,",
    ]


async def test_profile_is_only_written_when_it_differs():
    bot = SimpleNamespace(
        get_my_commands=AsyncMock(return_value=[]),
        set_my_commands=AsyncMock(),
        get_my_description=AsyncMock(return_value=SimpleNamespace(description=profile.DESCRIPTION)),
        set_my_description=AsyncMock(),
        get_my_short_description=AsyncMock(side_effect=OSError("network")),
        set_my_short_description=AsyncMock(),
    )
    assert await profile.setup_bot_profile(bot) == ["commands"]
    bot.set_my_commands.assert_awaited_once_with(profile.COMMANDS)
    bot.set_my_description.assert_not_awaited()

    bot.get_my_commands = AsyncMock(return_value=profile.COMMANDS)
    bot.set_my_commands.reset_mock()
    assert await profile.setup_bot_profile(bot) == []
    bot.set_my_commands.assert_not_awaited()


def test_profile_texts_fit_telegram_limits():
    assert len(profile.DESCRIPTION) <= 512
    assert len(profile.SHORT_DESCRIPTION) <= 120
    assert all(1 <= len(c.description) <= 256 for c in profile.COMMANDS)
