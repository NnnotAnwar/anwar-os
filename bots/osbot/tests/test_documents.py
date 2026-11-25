"""Documents: expiry reminder cards, sent once from the loop, and 💤 Remind tomorrow."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import SendMessage

from osbot import texts
from osbot.api import ApiError, ApiUnreachable
from osbot.documents import DocumentCb, document_keyboard, document_text, documents_once, when

from .conftest import Tg, bot_message, buttons, fake_api

D1 = "77777777-7777-4777-8777-777777777777"
D2 = "88888888-8888-4888-8888-888888888888"
URL = f"https://os.example/app/documents/{D1}"

ITEM = {
    "id": D1,
    "name": "Residence permit",
    "kind": "residence_permit",
    "kindLabel": "Residence permit / visa",
    "emoji": "🪪",
    "expiresOn": "2026-12-24",
    "dateLabel": "24 Dec 2026",
    "daysLeft": 30,
    "stage": "30",
    "late": False,
    "dueOn": "2026-11-24",
    "dueLabel": "24 Nov",
    "snoozed": False,
    "keys": [f"{D1}:2026-12-24:30"],
    "url": URL,
    "renewUrl": f"{URL}?renew=1",
}


def item(**changes):
    return {**ITEM, **changes}


# --- texts and keyboards -------------------------------------------------------------------


def test_the_card_reads_like_the_spec():
    assert document_text(ITEM) == "🪪 <b>Residence permit expires in 30 days</b> · 24 Dec 2026\n<i>Residence permit / visa</i>"


def test_when_counts_down_and_past_the_expiry_date():
    assert [when(item(daysLeft=n)) for n in (90, 2, 1, 0)] == ["expires in 90 days", "expires in 2 days", "expires tomorrow", "expires today"]
    # The day after the expiry date is its first invalid day.
    assert [when(item(daysLeft=n)) for n in (-1, -2, -5)] == ["expired today", "expired yesterday", "expired 4 days ago"]


def test_expired_late_and_snoozed_cards_say_so():
    expired = document_text(item(daysLeft=-1, stage="expired", dueOn="2026-12-25", dueLabel="25 Dec"))
    assert expired.startswith("🪪 <b>Residence permit expired today</b> · 24 Dec 2026")
    assert "Renew it, then tap ✓ Renewed." in expired
    late = document_text(item(daysLeft=26, late=True))
    assert "<b>Residence permit expires in 26 days</b>" in late
    assert "Due on 24 Nov; I was offline then." in late
    assert "💤 Reminding you again" in document_text(item(snoozed=True, stage="snooze", late=False))


def test_names_are_escaped_and_short():
    text = document_text(item(name="<Visa> & co " + "x" * 80))
    assert "&lt;Visa&gt; &amp; co" in text
    assert len(text) < 300


def test_buttons_open_renew_and_snooze():
    assert buttons(document_keyboard(ITEM)) == [
        ("↗ Open", URL),
        ("✓ Renewed", f"{URL}?renew=1"),
        ("💤 Remind tomorrow", f"dc:snz:{D1}"),
    ]
    # Telegram allows 64 bytes of callback data.
    assert len(DocumentCb(action="snz", id=D1).pack().encode()) <= 64
    # Without usable links only the snooze is left.
    assert buttons(document_keyboard(item(url=None, renewUrl="http://localhost/x"))) == [("💤 Remind tomorrow", f"dc:snz:{D1}")]


def test_help_mentions_documents():
    assert "Documents about to expire" in texts.HELP


# --- the loop -----------------------------------------------------------------------------


class FakeBot:
    def __init__(self, fail: bool = False):
        self.sent: list[SimpleNamespace] = []
        self.fail = fail

    async def send_message(self, chat_id, text, reply_markup=None):
        if self.fail:
            raise TelegramBadRequest(method=SendMessage(chat_id=chat_id, text=text), message="chat not found")
        self.sent.append(SimpleNamespace(chat_id=chat_id, text=text, reply_markup=reply_markup))
        return self.sent[-1]


def due(*items):
    return {"today": "2026-11-24", "time": "10:00", "reminderTime": "10:00", "items": list(items), "url": "https://os.example/app/documents"}


async def test_one_card_per_document_in_order_each_acked_after_sending():
    second = item(id=D2, name="Health insurance", emoji="🩺", kindLabel="Insurance", daysLeft=7, keys=[f"{D2}:2026-12-01:7"])
    bot = FakeBot()
    api = SimpleNamespace(documents_due=AsyncMock(return_value=due(ITEM, second)), ack_documents=AsyncMock(return_value=1))
    assert await documents_once(bot, api, 42) == 2
    assert [m.text.split("\n")[0] for m in bot.sent] == [
        "🪪 <b>Residence permit expires in 30 days</b> · 24 Dec 2026",
        "🩺 <b>Health insurance expires in 7 days</b> · 24 Dec 2026",
    ]
    assert [c.args[0] for c in api.ack_documents.await_args_list] == [ITEM["keys"], second["keys"]]


async def test_nothing_due_sends_nothing():
    bot = FakeBot()
    api = SimpleNamespace(documents_due=AsyncMock(return_value=due()), ack_documents=AsyncMock())
    assert await documents_once(bot, api, 42) == 0
    assert bot.sent == []
    api.ack_documents.assert_not_awaited()


async def test_an_unsent_card_is_not_acked_and_the_app_being_down_is_quiet():
    api = SimpleNamespace(documents_due=AsyncMock(return_value=due(ITEM)), ack_documents=AsyncMock())
    assert await documents_once(FakeBot(fail=True), api, 42) == 0
    api.ack_documents.assert_not_awaited()
    down = SimpleNamespace(documents_due=AsyncMock(side_effect=ApiUnreachable("down")), ack_documents=AsyncMock())
    assert await documents_once(FakeBot(), down, 42) == 0


async def test_a_failing_ack_does_not_repeat_the_card_every_minute():
    bot = FakeBot()
    api = SimpleNamespace(documents_due=AsyncMock(return_value=due(ITEM)), ack_documents=AsyncMock(side_effect=ApiUnreachable("down")))
    sent: set[str] = set()
    assert await documents_once(bot, api, 42, sent) == 1
    assert await documents_once(bot, api, 42, sent) == 0
    assert len(bot.sent) == 1


async def test_a_new_key_for_the_same_document_still_goes_out():
    # Snoozed until tomorrow: the next day brings the same document under a new key.
    bot = FakeBot()
    api = SimpleNamespace(documents_due=AsyncMock(return_value=due(ITEM)), ack_documents=AsyncMock(return_value=1))
    sent: set[str] = set()
    await documents_once(bot, api, 42, sent)
    api.documents_due = AsyncMock(return_value=due(item(snoozed=True, stage="snooze", keys=[f"{D1}:2026-12-24:snooze-2026-11-25"])))
    assert await documents_once(bot, api, 42, sent) == 1
    assert len(bot.sent) == 2


# --- 💤 Remind tomorrow ------------------------------------------------------------------------


SNOOZED = {"id": D1, "name": "Residence permit", "snoozedUntil": "2026-11-25", "label": "25 Nov", "time": "10:00"}


def card_message():
    return bot_message(
        "🪪 Residence permit expires in 30 days · 24 Dec 2026",
        reply_markup=document_keyboard(ITEM).model_dump(exclude_none=True),
    )


async def test_remind_tomorrow_snoozes_and_keeps_only_the_links():
    tg = Tg(fake_api(snooze_document=AsyncMock(return_value=SNOOZED)))
    await tg.press(f"dc:snz:{D1}", message=card_message())
    tg.api.snooze_document.assert_awaited_once_with(D1)
    edited = tg.session.last("EditMessageText")
    assert edited.text.endswith("<i>💤 I'll remind you again on 25 Nov at 10:00</i>")
    assert buttons(edited.reply_markup) == [("↗ Open", URL), ("✓ Renewed", f"{URL}?renew=1")]
    assert tg.toast().text == "💤 Tomorrow at 10:00"


async def test_remind_tomorrow_on_a_deleted_document_explains():
    tg = Tg(fake_api(snooze_document=AsyncMock(side_effect=ApiError(404, "gone", "That document doesn't exist anymore."))))
    await tg.press(f"dc:snz:{D1}", message=card_message())
    toast = tg.toast()
    assert toast.show_alert is True
    assert "doesn't exist anymore" in toast.text
    assert not tg.session.of("EditMessageText")


async def test_an_unknown_document_action_is_stale():
    tg = Tg(fake_api(snooze_document=AsyncMock()))
    await tg.press(f"dc:zzz:{D1}", message=card_message())
    tg.api.snooze_document.assert_not_awaited()
    assert tg.toast().text == texts.STALE
