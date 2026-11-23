"""End-to-end handler flows against the fake Budget API: save, edit, undo, history, overviews, CSV."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from expenses_bot import categories
from expenses_bot.handlers import commands, entries, expense
from expenses_bot.handlers.common import Flow, history_screen, overview_screen
from expenses_bot.keyboards import EntryCb, ExportCb, HistoryCb, PeriodCb, PickCb, short_id
from expenses_bot.periods import Period, local_midnight, now_local, today_local

from .tg import USER_ID, button_data, fake_callback, fake_message, last_text, new_state


async def test_quick_entry_picker_then_edit_everything(budget):
    api, fake, state = budget.api, budget.fake, new_state()

    # "250 coffee" -> picker (nothing learned yet)
    message = fake_message("250 coffee")
    await expense.quick_entry(message, state, api)
    picker = message.answer.call_args
    picker_id = int(next(iter((await state.get_data())["drafts"])))
    food_token = "pk:" + categories.token(fake.category_id("Food"))
    food = next(d for d in button_data(picker.kwargs["reply_markup"]) if d.startswith(food_token))

    # tap Food -> saved card, edited in place, with Budget's running totals
    callback = fake_callback(food, message_id=picker_id)
    await expense.process_category(callback, PickCb.unpack(food), state, api)
    card = callback.message.edit_text.call_args
    assert "✅ <b>Saved</b>" in card.args[0] and "📝 coffee" in card.args[0]
    assert "Today 250 CZK" in card.args[0]
    (row,) = fake.expenses()
    assert (row.amount_minor, fake.categories[row.category_id], row.note) == (-25000, "Food", "coffee")
    expense_id = short_id(row.id)

    # next time "coffee" is filed under Food without asking (learned from Budget)
    again = fake_message("90 Coffee")
    await expense.quick_entry(again, state, api)
    assert last_text(again.answer).startswith("✅ <b>Saved</b>")
    assert "🍔 Food" in last_text(again.answer)

    # ✏️ Amount -> prompt on the card -> new amount -> fresh card, old one deleted
    tap = EntryCb(action="a", id=expense_id, origin="s")
    cb = fake_callback(tap.pack(), message_id=777)
    await entries.on_entry(cb, tap, state, api)
    assert "Send the new amount" in cb.message.edit_text.call_args.args[0]
    assert await state.get_state() == Flow.edit_amount.state
    bad = fake_message("lots")
    await entries.on_new_amount(bad, state, api)
    assert "doesn't look like an amount" in last_text(bad.answer)
    reply = fake_message("320,5")
    await entries.on_new_amount(reply, state, api)
    assert "<b>320.50 CZK</b>" in last_text(reply.answer)
    reply.bot.delete_message.assert_awaited_once_with(USER_ID, 777)
    assert await state.get_state() is None
    assert row.amount_minor == -32050

    # 📝 Note -> "-" removes it
    tap = EntryCb(action="n", id=expense_id, origin="s")
    await entries.on_entry(fake_callback(tap.pack()), tap, state, api)
    reply = fake_message("-")
    await entries.on_new_note(reply, state, api)
    assert "📝" not in last_text(reply.answer) and row.note == ""

    # 🏷 Category -> picker -> Health
    tap = EntryCb(action="c", id=expense_id, origin="s")
    cb = fake_callback(tap.pack())
    await entries.on_entry(cb, tap, state, api)
    markup = cb.message.edit_text.call_args.kwargs["reply_markup"]
    assert any(b.text == "✓ 🍔 Food" for r in markup.inline_keyboard for b in r)
    health = next(d for d in button_data(markup) if d.endswith(categories.token(fake.category_id("Health"))))
    cb = fake_callback(health)
    await entries.on_entry(cb, EntryCb.unpack(health), state, api)
    assert "💊 Health" in cb.message.edit_text.call_args.args[0]
    cb.answer.assert_awaited_once_with("Category: Health")
    assert fake.categories[row.category_id] == "Health"

    # ↩️ Undo
    tap = EntryCb(action="u", id=expense_id, origin="s")
    cb = fake_callback(tap.pack())
    await entries.on_entry(cb, tap, state, api)
    assert "Removed" in cb.message.edit_text.call_args.args[0]
    assert fake.find(row.id) is None
    # Undo again on the same (stale) card
    cb = fake_callback(tap.pack())
    await entries.on_entry(cb, tap, state, api)
    cb.answer.assert_awaited_once_with(entries.GONE, show_alert=True)


async def test_an_expense_deleted_in_budget_during_an_edit(budget):
    api, fake, state = budget.api, budget.fake, new_state()
    txn = fake.add(1000, "Food", "x")
    tap = EntryCb(action="a", id=short_id(txn.id), origin="s")
    await entries.on_entry(fake_callback(tap.pack()), tap, state, api)
    fake.txns.remove(txn)  # deleted on the web meanwhile
    reply = fake_message("50")
    await entries.on_new_amount(reply, state, api)
    assert last_text(reply.answer) == entries.GONE
    assert await state.get_state() is None


async def test_a_refused_edit_keeps_the_prompt_open(budget):
    api, fake, state = budget.api, budget.fake, new_state()
    txn = fake.add(1000, "Food")
    tap = EntryCb(action="a", id=short_id(txn.id), origin="s")
    await entries.on_entry(fake_callback(tap.pack()), tap, state, api)
    fake.fail["/expense/update"] = (422, {"error": "rejected", "message": "That amount is too large."})
    reply = fake_message("999999999")
    await entries.on_new_amount(reply, state, api)
    assert "That amount is too large." in last_text(reply.answer)
    assert await state.get_state() == Flow.edit_amount.state


async def test_history_pagination_and_delete_with_confirm(budget):
    api, fake, state = budget.api, budget.fake, new_state()
    now = datetime.now(UTC)
    txns = [fake.add(100 * (i + 1), "Food", at=now - timedelta(minutes=i)) for i in range(10)]

    text, markup = await history_screen(api, 0)
    assert "1–8 of 10" in text
    assert button_data(markup)[-1] == HistoryCb(page=1).pack()

    cb_data = HistoryCb(page=1)
    cb = fake_callback(cb_data.pack())
    await commands.on_history_page(cb, cb_data, state, api)
    assert "9–10 of 10" in cb.message.edit_text.call_args.args[0]

    # open the 9th entry from page 2, ask to delete, confirm
    target = txns[8]
    for action in ("v", "d", "dy"):
        tap = EntryCb(action=action, id=short_id(target.id), origin="1")
        cb = fake_callback(tap.pack())
        await entries.on_entry(cb, tap, state, api)
        if action == "d":
            assert "Delete this expense?" in cb.message.edit_text.call_args.args[0]
            assert fake.find(target.id) is not None
    assert "9–9 of 9" in cb.message.edit_text.call_args.args[0]
    assert cb.answer.call_args.args[0].startswith("🗑 Deleted")

    # A page that no longer exists falls back to the last one.
    text, _ = await history_screen(api, 5)
    assert "9–9 of 9" in text

    # Something deleted in Budget, opened from the list: say so and show the list again.
    gone = txns[0]
    fake.txns.remove(gone)
    tap = EntryCb(action="v", id=short_id(gone.id), origin="0")
    cb = fake_callback(tap.pack())
    await entries.on_entry(cb, tap, state, api)
    cb.answer.assert_awaited_once_with(entries.GONE, show_alert=True)
    assert "1–8 of 8" in cb.message.edit_text.call_args.args[0]


async def test_history_shows_expenses_typed_in_budget_too(budget):
    budget.fake.add(4200, None, "from the web", on=today_local() - timedelta(days=3), at=datetime.now(UTC))
    text, _ = await history_screen(budget.api, 0)
    assert "❔ Uncategorised — from the web" in text
    assert "<i>" not in text  # backdated: no time of day to show


async def test_overview_screens(budget):
    api, fake, state = budget.api, budget.fake, new_state()
    message = fake_message("/month")
    await commands.cmd_month(message, state, api)
    assert "Nothing logged yet" in last_text(message.answer)

    fake.add(25000, "Food", "coffee")
    text, _ = await overview_screen(api, Period.current("d"))
    assert "<b>250 CZK</b> · 1 expense" in text and "coffee" in text

    prev = Period.current("m").prev
    cb_data = PeriodCb(p=prev.encode())
    cb = fake_callback(cb_data.pack())
    await commands.on_period(cb, cb_data, api)
    assert prev.title() in cb.message.edit_text.call_args.args[0]
    cb.answer.assert_awaited_once_with()


async def test_month_compares_with_last_month_up_to_the_same_point(budget):
    fake = budget.fake
    month = Period.current("m")
    elapsed = now_local() - local_midnight(month.start)
    prev_start = local_midnight(month.prev.start)
    # Last month: one expense well before "this point", one after it.
    fake.add(10000, "Food", at=prev_start + timedelta(minutes=1))
    late = prev_start + elapsed + timedelta(hours=1)
    if late.date() < month.start:
        fake.add(99900, "Food", at=late)
    fake.add(12000, "Food")
    text, _ = await overview_screen(budget.api, month)
    assert "▲ 20% vs" in text and "at this point" in text


async def test_overview_and_csv_follow_the_budget_day_not_the_recording_time(budget):
    fake = budget.fake
    yesterday = today_local() - timedelta(days=1)
    fake.add(5000, "Travel", "train", on=yesterday)  # typed today, counts for yesterday
    today_text, _ = await overview_screen(budget.api, Period.current("d"))
    assert "Nothing logged yet" in today_text
    day_text, _ = await overview_screen(budget.api, Period("d", yesterday))
    assert "--:--" in day_text and "Travel · train" in day_text


async def test_export_sends_a_csv_document(budget):
    api, fake = budget.api, budget.fake
    fake.add(1550, "Food", "lunch")
    cb_data = ExportCb(p=Period.current("m").encode())
    cb = fake_callback(cb_data.pack())
    await commands.on_export(cb, cb_data, api)
    document = cb.message.answer_document.call_args.args[0]
    assert document.filename.startswith("expenses-") and document.filename.endswith(".csv")
    assert b"15.50,CZK,Food,lunch" in document.data
    assert "1 expense" in cb.message.answer_document.call_args.kwargs["caption"]

    empty = fake_message("/export 2020-01")
    await commands.cmd_export(empty, commands.CommandObject(command="export", args="2020-01"), new_state(), api)
    assert "Nothing to export for January 2020" in last_text(empty.answer)
