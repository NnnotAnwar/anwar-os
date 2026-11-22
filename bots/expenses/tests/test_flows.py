"""New repository functions and end-to-end handler flows against a real Postgres."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import asyncpg
import pytest

from expenses_bot import categories, repo
from expenses_bot.handlers import commands, entries, expense
from expenses_bot.handlers.common import Flow, history_screen, overview_screen
from expenses_bot.keyboards import EntryCb, ExportCb, HistoryCb, PeriodCb, PickCb
from expenses_bot.periods import Period

from .conftest import needs_db
from .tg import USER_ID, button_data, fake_callback, fake_message, last_text, new_state

pytestmark = needs_db


async def _insert(pool, amount, category, at, note=None, user_id=USER_ID, currency="CZK"):
    await pool.execute("insert into bot_expenses.users (telegram_id) values ($1) on conflict do nothing", user_id)
    return await pool.fetchval(
        "insert into bot_expenses.expenses (telegram_user_id, amount_minor, currency, category, created_at, note)"
        " values ($1, $2, $3, $4, $5, $6) returning id",
        user_id, amount, currency, category, at, note,
    )


# --- repository --------------------------------------------------------------------


async def test_old_rows_without_note_still_work(clean):
    pool = clean
    # Exactly the importer's insert (no note column).
    await pool.execute("insert into bot_expenses.users (telegram_id) values (1)")
    await pool.execute(
        "insert into bot_expenses.expenses (telegram_user_id, amount_minor, currency, category, created_at, external_ref)"
        " values (1, 1550, 'CZK', 'Food', now(), 'sqlite:1')"
    )
    rows, total = await repo.list_expenses(pool, 1, 10)
    assert total == 1 and rows[0]["note"] is None
    with pytest.raises(asyncpg.CheckViolationError):
        await repo.add_expense(pool, 1, 100, "Food", note="")


async def test_update_and_delete_are_scoped_to_the_owner(clean):
    pool = clean
    expense_id = await repo.add_expense(pool, 1, 1000, "Food", note="coffee")
    assert await repo.update_expense(pool, 2, expense_id, amount_minor=5) is None
    assert await repo.delete_expense(pool, 2, expense_id) is None
    assert await repo.get_expense(pool, 2, expense_id) is None

    row = await repo.update_expense(pool, 1, expense_id, amount_minor=2000)
    assert (row["amount_minor"], row["category"], row["note"]) == (2000, "Food", "coffee")
    row = await repo.update_expense(pool, 1, expense_id, category="Health", note="pills")
    assert (row["amount_minor"], row["category"], row["note"]) == (2000, "Health", "pills")
    row = await repo.update_expense(pool, 1, expense_id, clear_note=True)
    assert row["note"] is None
    assert (await repo.delete_expense(pool, 1, expense_id))["id"] == expense_id
    assert await repo.get_expense(pool, 1, expense_id) is None


async def test_category_learning_and_frequency(clean):
    pool = clean
    now = datetime.now(UTC)
    await _insert(pool, 100, "Food", now, note="Coffee")
    await _insert(pool, 100, "Food", now, note="coffee")
    await _insert(pool, 100, "Fun", now - timedelta(minutes=1), note="coffee")
    await _insert(pool, 100, "Transport", now - timedelta(days=200))
    await _insert(pool, 100, "Health", now)
    assert await repo.category_for_note(pool, USER_ID, "COFFEE") == "Food"
    assert await repo.category_for_note(pool, USER_ID, "tea") is None
    assert await repo.frequent_categories(pool, USER_ID) == ["Food", "Health", "Fun"]
    assert sorted(await repo.known_categories(pool, USER_ID)) == ["Food", "Fun", "Health", "Transport"]


async def test_totals_between(clean):
    pool = clean
    nov = Period.containing("m", datetime(2026, 11, 10).date())
    await _insert(pool, 1000, "Food", datetime(2026, 10, 31, 23, 30, tzinfo=UTC))  # Nov 1 in Prague
    await _insert(pool, 500, "Food", datetime(2026, 11, 5, 12, tzinfo=UTC))
    await _insert(pool, 700, "Fun", datetime(2026, 11, 6, 12, tzinfo=UTC), currency="EUR")
    await _insert(pool, 9999, "Food", datetime(2026, 12, 1, 0, 30, tzinfo=UTC))  # December in Prague
    rows = await repo.category_totals(pool, USER_ID, *nov.bounds())
    assert [(r["category"], r["currency"], r["total_minor"], r["n"]) for r in rows] == [
        ("Food", "CZK", 1500, 2),
        ("Fun", "EUR", 700, 1),
    ]
    assert await repo.currency_totals(pool, USER_ID, *nov.bounds()) == {"CZK": 1500, "EUR": 700}
    assert len(await repo.expenses_between(pool, USER_ID, *nov.bounds())) == 3


# --- flows -------------------------------------------------------------------------


async def test_quick_entry_picker_then_edit_everything(clean):
    pool, state = clean, new_state()

    # "250 coffee" -> picker (nothing learned yet)
    message = fake_message("250 coffee")
    await expense.quick_entry(message, state, pool)
    picker = message.answer.call_args
    picker_id = int(next(iter((await state.get_data())["drafts"])))
    food = next(d for d in button_data(picker.kwargs["reply_markup"]) if d.startswith("pk:" + categories.token("Food")))

    # tap Food -> saved card, edited in place
    callback = fake_callback(food, message_id=picker_id)
    await expense.process_category(callback, PickCb.unpack(food), state, pool)
    card = callback.message.edit_text.call_args
    assert "✅ <b>Saved</b>" in card.args[0] and "📝 coffee" in card.args[0]
    assert "Today 250\u00a0CZK" in card.args[0]
    row = (await repo.list_expenses(pool, USER_ID, 1))[0][0]
    assert (row["amount_minor"], row["category"], row["note"]) == (25000, "Food", "coffee")
    expense_id = row["id"]

    # next time "coffee" is filed under Food without asking
    again = fake_message("90 Coffee")
    await expense.quick_entry(again, state, pool)
    assert last_text(again.answer).startswith("✅ <b>Saved</b>")
    assert "🍔 Food" in last_text(again.answer)

    # ✏️ Amount -> prompt on the card -> new amount -> fresh card, old one deleted
    tap = EntryCb(action="a", id=expense_id, origin="s")
    cb = fake_callback(tap.pack(), message_id=777)
    await entries.on_entry(cb, tap, state, pool)
    assert "Send the new amount" in cb.message.edit_text.call_args.args[0]
    assert await state.get_state() == Flow.edit_amount.state
    bad = fake_message("lots")
    await entries.on_new_amount(bad, state, pool)
    assert "doesn't look like an amount" in last_text(bad.answer)
    reply = fake_message("320,5")
    await entries.on_new_amount(reply, state, pool)
    assert "<b>320.50\u00a0CZK</b>" in last_text(reply.answer)
    reply.bot.delete_message.assert_awaited_once_with(USER_ID, 777)
    assert await state.get_state() is None

    # 📝 Note -> "-" removes it
    tap = EntryCb(action="n", id=expense_id, origin="s")
    await entries.on_entry(fake_callback(tap.pack()), tap, state, pool)
    reply = fake_message("-")
    await entries.on_new_note(reply, state, pool)
    assert "📝" not in last_text(reply.answer)

    # 🏷 Category -> picker -> Health
    tap = EntryCb(action="c", id=expense_id, origin="s")
    cb = fake_callback(tap.pack())
    await entries.on_entry(cb, tap, state, pool)
    health = next(d for d in button_data(cb.message.edit_text.call_args.kwargs["reply_markup"])
                  if d.endswith(categories.token("Health")))
    cb = fake_callback(health)
    await entries.on_entry(cb, EntryCb.unpack(health), state, pool)
    assert "💊 Health" in cb.message.edit_text.call_args.args[0]
    cb.answer.assert_awaited_once_with("Category: Health")

    # ↩️ Undo
    tap = EntryCb(action="u", id=expense_id, origin="s")
    cb = fake_callback(tap.pack())
    await entries.on_entry(cb, tap, state, pool)
    assert "Removed" in cb.message.edit_text.call_args.args[0]
    assert await repo.get_expense(pool, USER_ID, expense_id) is None
    # Undo again on the same (stale) card
    cb = fake_callback(tap.pack())
    await entries.on_entry(cb, tap, state, pool)
    cb.answer.assert_awaited_once_with(entries.GONE, show_alert=True)


async def test_history_pagination_and_delete_with_confirm(clean):
    pool, state = clean, new_state()
    now = datetime.now(UTC)
    ids = [await _insert(pool, 100 * (i + 1), "Food", now - timedelta(minutes=i)) for i in range(10)]

    text, markup = await history_screen(pool, USER_ID, 0)
    assert "1–8 of 10" in text
    assert button_data(markup)[-1] == HistoryCb(page=1).pack()

    cb_data = HistoryCb(page=1)
    cb = fake_callback(cb_data.pack())
    await commands.on_history_page(cb, cb_data, state, pool)
    assert "9–10 of 10" in cb.message.edit_text.call_args.args[0]

    # open the 9th entry from page 2, ask to delete, confirm
    target = ids[8]
    for action in ("v", "d", "dy"):
        tap = EntryCb(action=action, id=target, origin="1")
        cb = fake_callback(tap.pack())
        await entries.on_entry(cb, tap, state, pool)
        if action == "d":
            assert "Delete this expense?" in cb.message.edit_text.call_args.args[0]
            assert await repo.get_expense(pool, USER_ID, target) is not None
    assert "9–9 of 9" in cb.message.edit_text.call_args.args[0]
    assert cb.answer.call_args.args[0].startswith("🗑 Deleted")

    # A page that no longer exists falls back to the last one.
    text, _ = await history_screen(pool, USER_ID, 5)
    assert "9–9 of 9" in text


async def test_overview_screens(clean):
    pool, state = clean, new_state()
    message = fake_message("/month")
    await commands.cmd_month(message, state, pool)
    assert "Nothing logged yet" in last_text(message.answer)

    await repo.add_expense(pool, USER_ID, 25000, "Food", note="coffee")
    text, _ = await overview_screen(pool, USER_ID, Period.current("d"))
    assert "<b>250\u00a0CZK</b> · 1 expense" in text and "coffee" in text

    prev = Period.current("m").prev
    cb_data = PeriodCb(p=prev.encode())
    cb = fake_callback(cb_data.pack())
    await commands.on_period(cb, cb_data, pool)
    assert prev.title() in cb.message.edit_text.call_args.args[0]
    cb.answer.assert_awaited_once_with()


async def test_export_sends_a_csv_document(clean):
    pool = clean
    await repo.add_expense(pool, USER_ID, 1550, "Food", note="lunch")
    cb_data = ExportCb(p=Period.current("m").encode())
    cb = fake_callback(cb_data.pack())
    await commands.on_export(cb, cb_data, pool)
    document = cb.message.answer_document.call_args.args[0]
    assert document.filename.startswith("expenses-") and document.filename.endswith(".csv")
    assert b"15.50,CZK,Food,lunch" in document.data
    assert "1 expense" in cb.message.answer_document.call_args.kwargs["caption"]

    empty = fake_message("/export 2020-01")
    await commands.cmd_export(empty, commands.CommandObject(command="export", args="2020-01"), new_state(), pool)
    assert "Nothing to export for January 2020" in last_text(empty.answer)
