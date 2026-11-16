"""Light handler tests with mocked Telegram objects and FSM context."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from expenses_bot.handlers import commands, expense


class FakeState:
    def __init__(self):
        self.state = None
        self.data: dict = {}

    async def set_state(self, state):
        self.state = state

    async def update_data(self, **kwargs):
        self.data.update(kwargs)

    async def get_data(self):
        return dict(self.data)

    async def clear(self):
        self.state = None
        self.data = {}


def fake_message(text, user_id=42):
    return SimpleNamespace(
        text=text,
        from_user=SimpleNamespace(id=user_id, first_name="Anwar", username="anwar"),
        answer=AsyncMock(),
    )


def fake_callback(data, user_id=42):
    return SimpleNamespace(
        data=data,
        from_user=SimpleNamespace(id=user_id),
        message=SimpleNamespace(edit_text=AsyncMock()),
        answer=AsyncMock(),
    )


async def test_process_amount_rejects_non_text_message():
    message, state = fake_message(None), FakeState()  # e.g. a sticker
    await expense.process_amount(message, state)
    assert "Invalid amount" in message.answer.call_args.args[0]
    assert state.data == {}


async def test_process_amount_accepts_and_asks_for_category():
    message, state = fake_message("15,5"), FakeState()
    await expense.process_amount(message, state)
    assert state.data == {"amount_minor": 1550}
    assert state.state == expense.ExpenseStates.waiting_for_category
    assert message.answer.call_args.args[0] == "Amount set to 15.50 CZK. Now, select a category:"
    assert message.answer.call_args.kwargs["reply_markup"] is not None


async def test_process_category_saves_expense(monkeypatch):
    add = AsyncMock(return_value=1)
    monkeypatch.setattr(expense.repo, "add_expense", add)
    state = FakeState()
    await state.set_state(expense.ExpenseStates.waiting_for_category)
    await state.update_data(amount_minor=1550)
    callback, pool = fake_callback("category_Food"), object()

    await expense.process_category(callback, state, pool)

    add.assert_awaited_once_with(pool, 42, 1550, "Food", "CZK")
    assert "Amount: 15.50 CZK\nCategory: Food" in callback.message.edit_text.call_args.args[0]
    assert state.state is None
    callback.answer.assert_awaited_once_with()


async def test_process_category_restores_state_when_save_fails(monkeypatch):
    monkeypatch.setattr(expense.repo, "add_expense", AsyncMock(side_effect=OSError("db down")))
    state = FakeState()
    await state.set_state(expense.ExpenseStates.waiting_for_category)
    await state.update_data(amount_minor=1550)
    callback = fake_callback("category_Food")

    await expense.process_category(callback, state, object())

    assert state.state == expense.ExpenseStates.waiting_for_category
    assert state.data == {"amount_minor": 1550}
    assert callback.answer.call_args.kwargs["show_alert"] is True
    callback.message.edit_text.assert_not_awaited()


@pytest.mark.parametrize("data", ["category_Food", "category_Unknown"])
async def test_expired_or_unknown_category_buttons_are_answered(data, monkeypatch):
    add = AsyncMock()
    monkeypatch.setattr(expense.repo, "add_expense", add)
    callback = fake_callback(data)
    if data == "category_Unknown":
        state = FakeState()
        await state.update_data(amount_minor=100)
        await expense.process_category(callback, state, object())
    else:
        await expense.stale_category(callback)
    assert "expired" in callback.answer.call_args.args[0]
    add.assert_not_awaited()


async def test_history_formats_amounts_with_currency(monkeypatch):
    rows = [{"amount_minor": 1550, "currency": "CZK", "category": "Food", "created_at": datetime(2026, 11, 16, 9, 5, 7)}]
    monkeypatch.setattr(commands.repo, "get_recent_expenses", AsyncMock(return_value=rows))
    message = fake_message("/history")
    await commands.cmd_history(message, object())
    text = message.answer.call_args.args[0]
    assert "• <b>15.50 CZK</b> - Food (2026-11-16 09:05)" in text
    assert message.answer.call_args.kwargs["parse_mode"] == "HTML"


async def test_stats_totals_per_currency(monkeypatch):
    rows = [
        {"category": "Food", "currency": "CZK", "total_minor": 1000},
        {"category": "Health", "currency": "EUR", "total_minor": 250},
        {"category": "Transport", "currency": "CZK", "total_minor": 550},
    ]
    monkeypatch.setattr(commands.repo, "get_monthly_stats", AsyncMock(return_value=rows))
    message = fake_message("/stats")
    await commands.cmd_stats(message, object())
    text = message.answer.call_args.args[0]
    assert "• Food: <b>10.00 CZK</b>" in text
    assert text.endswith("💰 <b>Total:</b> <b>15.50 CZK, 2.50 EUR</b>")


async def test_stats_empty(monkeypatch):
    monkeypatch.setattr(commands.repo, "get_monthly_stats", AsyncMock(return_value=[]))
    message = fake_message("/stats")
    await commands.cmd_stats(message, object())
    message.answer.assert_awaited_once_with("No expenses recorded for this month.")
