"""Handler tests with mocked Telegram objects and a mocked repository (no database)."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import EditMessageText

from expenses_bot import categories, keyboards, profile, render
from expenses_bot.handlers import commands, entries, expense, fallback
from expenses_bot.handlers.common import Flow, put_draft
from expenses_bot.keyboards import EntryCb, PickCb
from expenses_bot.ui import show

from .tg import fake_callback, fake_message, last_text, new_state


def _row(**kw):
    row = {"id": 1, "amount_minor": 25000, "currency": "CZK", "category": "Food", "note": None,
           "created_at": datetime.now(UTC)}
    row.update(kw)
    return row


def _no_db(monkeypatch, **overrides):
    """Patch the repo functions the expense handlers touch."""
    defaults = {
        "known_categories": AsyncMock(return_value=[]),
        "frequent_categories": AsyncMock(return_value=["Health"]),
        "category_for_note": AsyncMock(return_value=None),
        "add_expense": AsyncMock(return_value=1),
        "get_expense": AsyncMock(return_value=_row()),
        "currency_totals": AsyncMock(return_value={}),
    }
    defaults.update(overrides)
    for name, mock in defaults.items():
        monkeypatch.setattr(expense.repo, name, mock)
    return SimpleNamespace(**defaults)


async def test_start_shows_welcome_and_menu():
    message, state = fake_message("/start"), new_state()
    await state.set_state(Flow.edit_amount)
    await commands.cmd_start(message, state)
    assert "<code>250 coffee</code>" in last_text(message.answer)
    assert message.answer.call_args.kwargs["reply_markup"].is_persistent
    assert await state.get_state() is None


async def test_unparsable_text_gets_a_hint(monkeypatch):
    repo = _no_db(monkeypatch)
    message = fake_message("hello there")
    await expense.quick_entry(message, new_state(), object())
    assert last_text(message.answer) == render.unknown_text()
    repo.add_expense.assert_not_awaited()


async def test_add_flow_rejects_non_text(monkeypatch):
    _no_db(monkeypatch)
    message, state = fake_message(None), new_state()  # e.g. a sticker
    await state.set_state(Flow.amount)
    await expense.process_amount(message, state, object())
    assert "doesn't look like an amount" in last_text(message.answer)
    assert await state.get_state() == Flow.amount.state


async def test_amount_only_opens_picker_with_frequent_first(monkeypatch):
    _no_db(monkeypatch)
    message, state = fake_message("250"), new_state()
    await expense.quick_entry(message, state, object())
    assert last_text(message.answer) == "💸 <b>250\u00a0CZK</b>\nPick a category:"
    markup = message.answer.call_args.kwargs["reply_markup"]
    assert markup.inline_keyboard[0][0].text == "💊 Health"
    assert markup.inline_keyboard[-1][0].text == "✖ Cancel"
    drafts = (await state.get_data())["drafts"]
    assert list(drafts.values()) == [{"a": 25000, "n": None}]


async def test_category_word_saves_directly(monkeypatch):
    repo = _no_db(monkeypatch, get_expense=AsyncMock(return_value=_row(note="lunch")))
    message = fake_message("250 food lunch")
    await expense.quick_entry(message, new_state(), object())
    repo.add_expense.assert_awaited_once()
    assert repo.add_expense.call_args.args[1:5] == (42, 25000, "Food", "CZK")
    assert repo.add_expense.call_args.kwargs == {"note": "lunch"}
    assert last_text(message.answer).startswith("✅ <b>Saved</b>")


async def test_learned_note_saves_directly(monkeypatch):
    repo = _no_db(monkeypatch, category_for_note=AsyncMock(return_value="Food"))
    message = fake_message("250 coffee")
    await expense.quick_entry(message, new_state(), object())
    assert repo.add_expense.call_args.args[3] == "Food"
    assert repo.add_expense.call_args.kwargs == {"note": "coffee"}


async def test_save_failure_is_reported(monkeypatch):
    _no_db(monkeypatch, add_expense=AsyncMock(side_effect=OSError("db down")))
    message = fake_message("250 food")
    await expense.quick_entry(message, new_state(), object())
    assert last_text(message.answer) == expense.SAVE_FAILED


async def test_picker_double_tap_saves_once(monkeypatch):
    repo = _no_db(monkeypatch)
    state = new_state()
    await put_draft(state, 500, 1550, "coffee")
    data = PickCb(cat=categories.token("Food"), amount=1550, note=True).pack()

    first = fake_callback(data, message_id=500)
    await expense.process_category(first, PickCb.unpack(data), state, object())
    second = fake_callback(data, message_id=500)
    await expense.process_category(second, PickCb.unpack(data), state, object())

    repo.add_expense.assert_awaited_once()
    assert repo.add_expense.call_args.kwargs == {"note": "coffee"}
    first.answer.assert_awaited_once_with("Saved")
    second.answer.assert_awaited_once_with("Already saved.")


async def test_picker_after_restart(monkeypatch):
    repo = _no_db(monkeypatch)
    tok = categories.token("Food")
    # Without a note the button carries everything needed.
    plain = PickCb(cat=tok, amount=1550, note=False)
    callback = fake_callback(plain.pack())
    await expense.process_category(callback, plain, new_state(), object())
    assert repo.add_expense.call_args.args[2:4] == (1550, "Food")
    # With a note the draft is gone: say so instead of saving without it.
    noted = PickCb(cat=tok, amount=1550, note=True)
    callback = fake_callback(noted.pack())
    await expense.process_category(callback, noted, new_state(), object())
    assert "expired" in callback.answer.call_args.args[0]
    assert repo.add_expense.await_count == 1


async def test_picker_restores_draft_when_save_fails(monkeypatch):
    _no_db(monkeypatch, add_expense=AsyncMock(side_effect=OSError("db down")))
    state = new_state()
    await put_draft(state, 501, 1550, None)
    cb_data = PickCb(cat=categories.token("Food"), amount=1550, note=False)
    callback = fake_callback(cb_data.pack(), message_id=501)
    await expense.process_category(callback, cb_data, state, object())
    data = await state.get_data()
    assert data["drafts"] == {"501": {"a": 1550, "n": None}}
    assert 501 not in data["used"]
    assert callback.answer.call_args.kwargs["show_alert"] is True
    callback.message.edit_text.assert_not_awaited()


async def test_picker_cancel(monkeypatch):
    _no_db(monkeypatch)
    state = new_state()
    await put_draft(state, 502, 1550, None)
    cb_data = PickCb(cat="x", amount=0, note=False)
    callback = fake_callback(cb_data.pack(), message_id=502)
    await expense.process_category(callback, cb_data, state, object())
    assert "Cancelled" in callback.message.edit_text.call_args.args[0]
    assert (await state.get_data())["drafts"] == {}


async def test_missing_expense_is_answered(monkeypatch):
    monkeypatch.setattr(entries.repo, "get_expense", AsyncMock(return_value=None))
    cb_data = EntryCb(action="a", id=9, origin="s")
    callback = fake_callback(cb_data.pack())
    state = new_state()
    await entries.on_entry(callback, cb_data, state, object())
    callback.answer.assert_awaited_once_with(entries.GONE, show_alert=True)
    assert await state.get_state() is None


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


async def test_error_handler_tells_the_user():
    callback = fake_callback("x")
    event = SimpleNamespace(exception=RuntimeError("boom"), update=SimpleNamespace(callback_query=callback, message=None))
    assert await fallback.on_error(event) is True
    callback.answer.assert_awaited_once_with(fallback.OOPS, show_alert=True)

    message = fake_message("250")
    event = SimpleNamespace(exception=RuntimeError("boom"), update=SimpleNamespace(callback_query=None, message=message))
    await fallback.on_error(event)
    assert last_text(message.answer) == fallback.OOPS


async def test_export_csv_format():
    rows = [
        {"amount_minor": 125050, "currency": "CZK", "category": "Food", "note": 'say "hi", ok',
         "created_at": datetime(2026, 11, 22, 8, 15, tzinfo=UTC)},
        {"amount_minor": 25000, "currency": "CZK", "category": "Žrádlo", "note": None,
         "created_at": datetime(2026, 11, 22, 9, 0, tzinfo=UTC)},
    ]
    data = commands.build_csv(rows).decode("utf-8-sig").splitlines()
    assert data == [
        "date,time,amount,currency,category,note",
        '2026-11-22,09:15,1250.50,CZK,Food,"say ""hi"", ok"',
        "2026-11-22,10:00,250.00,CZK,Žrádlo,",
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
