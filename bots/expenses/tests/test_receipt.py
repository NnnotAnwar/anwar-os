"""Receipt photo -> draft card -> Save, against the fake Budget API plus a fake POST receipt.

The web app's side (Claude reading the photo) is replaced by a canned draft: what the bot
must get right is the flow: download into memory, one signed call, the card, category and
amount edits, saving into the right account, and the failure messages.
"""

from __future__ import annotations

import base64
import io
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest

from expenses_bot import categories
from expenses_bot.api import BudgetApi
from expenses_bot.handlers import receipt
from expenses_bot.handlers.receipt import ReceiptCb, ReceiptFlow
from expenses_bot.periods import today_local

from .fake_budget import SECRET, FakeBudget, Refused
from .tg import button_data, button_texts, fake_bot, fake_callback, fake_message, last_text, new_state

PHOTO = b"\xff\xd8\xff\xe0" + b"jpeg-bytes" * 10


class ReceiptBudget(FakeBudget):
    """FakeBudget + POST /receipt answering with `reply` (or an error via `fail`)."""

    reply: dict[str, Any] | None = None

    def route(self, method: str, path: str, query: dict[str, str], body: Any) -> Any:
        if (method, path) == ("POST", "/receipt"):
            if base64.b64decode(body["image"]) != PHOTO:
                raise Refused(422, "bad_image", "Send a JPEG, PNG, WebP or GIF photo.")
            return self.reply
        return super().route(method, path, query, body)


def draft(fake: FakeBudget, **over: Any) -> dict[str, Any]:
    base = {
        "amountMinor": 31200,
        "currency": "CZK",
        "merchant": "Albert",
        "summary": "groceries",
        "note": "Albert",
        "occurredOn": today_local().isoformat(),
        "dateAssumed": False,
        "categoryId": fake.category_id("Food"),
        "categoryName": "Food",
        "accountId": fake.account_id,
        "accountName": "Main account",
        "accountCurrency": "CZK",
        "currencyMismatch": False,
    }
    return {"status": "ok", "draft": {**base, **over}}


@pytest.fixture
async def rb():
    fake = ReceiptBudget()
    server = await fake.start()
    api = BudgetApi(str(server.make_url("")).rstrip("/"), SECRET)
    try:
        yield SimpleNamespace(fake=fake, api=api)
    finally:
        await api.close()
        await server.close()


def photo_message(**kwargs: Any):
    bot = fake_bot()
    bot.download = AsyncMock(side_effect=lambda file_id: io.BytesIO(PHOTO))
    message = fake_message(None, bot=bot)
    message.photo = [SimpleNamespace(file_id="small", file_size=900), SimpleNamespace(file_id="large", file_size=90_000)]
    message.document = None
    for key, value in kwargs.items():
        setattr(message, key, value)
    return message


async def send_photo(rb, state):
    message = photo_message()
    await receipt.on_photo(message, state, rb.api)
    return message


def card_id(state_data: dict[str, Any]) -> int:
    return int(next(iter(state_data["receipts"])))


async def test_photo_to_card_then_save(rb):
    rb.fake.reply = draft(rb.fake)
    state = new_state()
    message = await send_photo(rb, state)

    # Largest size downloaded, sent once (base64, signed), never kept by the bot.
    message.bot.download.assert_awaited_once_with("large")
    (call,) = [c for c in rb.fake.calls if c["path"].endswith("/receipt")]
    assert base64.b64decode(call["body"]["image"]) == PHOTO

    first, card = message.answer.call_args_list
    assert "Reading the receipt" in first.args[0]
    text = card.args[0]
    assert "💸 <b>312 CZK</b> · Albert · today · 🍔 Food?" in text
    assert "🛒 groceries" in text
    assert button_texts(card.kwargs["reply_markup"]) == [["✅ Save", "🏷 Category"], ["✏️ Amount", "✖ Cancel"]]
    assert rb.fake.expenses() == []  # nothing saved yet

    data = await state.get_data()
    cb = fake_callback(ReceiptCb(action="s").pack(), message_id=card_id(data))
    await receipt.on_receipt(cb, ReceiptCb(action="s"), state, rb.api)
    (row,) = rb.fake.expenses()
    assert (row.amount_minor, rb.fake.categories[row.category_id], row.note) == (-31200, "Food", "Albert")
    assert "✅ <b>Saved</b>" in cb.message.edit_text.call_args.args[0]
    cb.answer.assert_awaited_once_with("Saved")
    save_call = [c for c in rb.fake.calls if c["path"].endswith("/expenses")][-1]
    assert save_call["body"]["accountId"] == rb.fake.account_id

    # A second tap on the old card does not save twice.
    again = fake_callback(ReceiptCb(action="s").pack(), message_id=card_id(data))
    await receipt.on_receipt(again, ReceiptCb(action="s"), state, rb.api)
    assert len(rb.fake.expenses()) == 1
    assert "expired" in again.answer.call_args.args[0]


async def test_change_category_and_amount_before_saving(rb):
    rb.fake.reply = draft(rb.fake, categoryId=None, categoryName=None, dateAssumed=True)
    state = new_state()
    message = await send_photo(rb, state)
    text = last_text(message.answer)
    assert "no category yet" in text and "No date on the receipt" in text
    cid = card_id(await state.get_data())

    # 🏷 Category -> picker -> Fun
    cb = fake_callback(ReceiptCb(action="c").pack(), message_id=cid)
    await receipt.on_receipt(cb, ReceiptCb(action="c"), state, rb.api)
    markup = cb.message.edit_text.call_args.kwargs["reply_markup"]
    fun = next(d for d in button_data(markup) if d.endswith(categories.token(rb.fake.category_id("Fun"))))
    cb = fake_callback(fun, message_id=cid)
    await receipt.on_receipt(cb, ReceiptCb.unpack(fun), state, rb.api)
    assert "🎉 Fun?" in cb.message.edit_text.call_args.args[0]
    cb.answer.assert_awaited_once_with("Category: Fun")

    # ✏️ Amount -> "lots" is refused -> "420,50" -> a fresh card, the old one deleted
    cb = fake_callback(ReceiptCb(action="a").pack(), message_id=cid)
    await receipt.on_receipt(cb, ReceiptCb(action="a"), state, rb.api)
    assert await state.get_state() == ReceiptFlow.amount.state
    bad = fake_message("lots")
    await receipt.on_receipt_amount(bad, state)
    assert "doesn't look like an amount" in last_text(bad.answer)
    reply = fake_message("420,50")
    await receipt.on_receipt_amount(reply, state)
    assert "<b>420.50 CZK</b>" in last_text(reply.answer)
    reply.bot.delete_message.assert_awaited_once_with(reply.chat.id, cid)
    assert await state.get_state() is None

    new_id = card_id(await state.get_data())
    cb = fake_callback(ReceiptCb(action="s").pack(), message_id=new_id)
    await receipt.on_receipt(cb, ReceiptCb(action="s"), state, rb.api)
    (row,) = rb.fake.expenses()
    assert (row.amount_minor, rb.fake.categories[row.category_id]) == (-42050, "Fun")


async def test_save_without_category_asks_for_one_first(rb):
    rb.fake.reply = draft(rb.fake, categoryId=None, categoryName=None)
    state = new_state()
    await send_photo(rb, state)
    cid = card_id(await state.get_data())
    cb = fake_callback(ReceiptCb(action="s").pack(), message_id=cid)
    await receipt.on_receipt(cb, ReceiptCb(action="s"), state, rb.api)
    assert "Pick a category, then save" in cb.message.edit_text.call_args.args[0]
    assert rb.fake.expenses() == []


async def test_cancel_saves_nothing(rb):
    rb.fake.reply = draft(rb.fake)
    state = new_state()
    await send_photo(rb, state)
    cid = card_id(await state.get_data())
    cb = fake_callback(ReceiptCb(action="x").pack(), message_id=cid)
    await receipt.on_receipt(cb, ReceiptCb(action="x"), state, rb.api)
    assert cb.message.edit_text.call_args.args[0] == "Cancelled. Nothing was saved."
    assert rb.fake.expenses() == []
    assert (await state.get_data())["receipts"] == {}


async def test_foreign_currency_warning(rb):
    rb.fake.reply = draft(rb.fake, currency="EUR", amountMinor=420, currencyMismatch=True)
    state = new_state()
    message = await send_photo(rb, state)
    assert "receipt is in EUR but your account is in CZK" in last_text(message.answer)


async def test_not_a_receipt_and_failures(rb):
    state = new_state()
    rb.fake.reply = {"status": "not_receipt", "message": "That doesn't look like a receipt."}
    message = await send_photo(rb, state)
    assert "That doesn't look like a receipt." in last_text(message.answer)
    assert "receipts" not in await state.get_data()

    rb.fake.fail["/receipt"] = (503, {"error": "ai_disabled", "message": "Receipt reading is off: add ANTHROPIC_API_KEY on the server."})
    message = await send_photo(rb, state)
    assert "Receipt reading is off" in last_text(message.answer)
    assert "ANTHROPIC_API_KEY" in last_text(message.answer)

    rb.fake.fail["/receipt"] = (422, {"error": "unreadable", "message": "I couldn't read that receipt. Try a sharper photo."})
    message = await send_photo(rb, state)
    assert "Try a sharper photo" in last_text(message.answer)


async def test_large_files_and_expired_cards(rb):
    state = new_state()
    big = photo_message(photo=None, document=SimpleNamespace(file_id="doc", file_size=9 * 1024 * 1024, mime_type="image/png"))
    await receipt.on_photo(big, state, rb.api)
    assert "over 5 MB" in last_text(big.answer)
    big.bot.download.assert_not_awaited()

    cb = fake_callback(ReceiptCb(action="s").pack(), message_id=424242)
    await receipt.on_receipt(cb, ReceiptCb(action="s"), state, rb.api)
    assert cb.answer.call_args.kwargs.get("show_alert") is True
    assert "expired" in cb.answer.call_args.args[0]


async def test_photos_reach_the_receipt_router(rb):
    """Through the real dispatcher: a photo goes to the receipt flow, not "I didn't catch an amount"."""
    from datetime import UTC, datetime

    from aiogram import Bot
    from aiogram.methods import SendMessage
    from aiogram.types import Message, PhotoSize, Update

    from .test_routing import CHAT, USER, RecordingSession
    from .tg import fresh_dispatcher

    rb.fake.reply = draft(rb.fake)
    dp = fresh_dispatcher(rb.api, owner_id=USER.id)
    session = RecordingSession()
    bot = Bot(token="42:TEST", session=session)
    bot.download = AsyncMock(return_value=io.BytesIO(PHOTO))  # type: ignore[method-assign]
    photo = PhotoSize(file_id="p", file_unique_id="u", width=800, height=1200, file_size=50_000)
    update = Update(update_id=1, message=Message(message_id=1, date=datetime.now(UTC), chat=CHAT, from_user=USER, photo=[photo]))
    await dp.feed_update(bot, update)
    texts = [m.text for m in session.calls if isinstance(m, SendMessage)]
    assert any("Reading the receipt" in t for t in texts)
    assert not any("didn't catch an amount" in t for t in texts)
    bot.download.assert_awaited_once_with("p")


def test_card_keyboard_fits_callback_limits():
    for action in ("s", "c", "a", "x", "b"):
        assert len(ReceiptCb(action=action).pack().encode()) <= 64
    assert len(ReceiptCb(action="cs", cat="deadbeef").pack().encode()) <= 64
