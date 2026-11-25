"""The journal: the question card, a face, the line as a reply, Skip, Undo, /journal and the evening loop."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.types import ForceReply

from osbot import app, texts
from osbot.api import ApiError, ApiUnreachable
from osbot.journal import (
    CANT_UNDO,
    JournalCb,
    JournalMemory,
    journal_once,
    prompt_day,
    prompt_text,
    question_keyboard,
    question_text,
    saved_text,
)

from .conftest import Tg, bot_message, buttons, fake_api

DAY = "2026-11-25"
URL = f"https://os.example/app/journal?day={DAY}"
CARD = {"date": DAY, "today": DAY, "label": "Wednesday 25 Nov", "short": "Wed 25 Nov 2026", "entry": None, "url": URL}
FACES = [("😞", f"jn:m:{DAY}:1:0:0"), ("🙁", f"jn:m:{DAY}:2:0:0"), ("😐", f"jn:m:{DAY}:3:0:0"), ("🙂", f"jn:m:{DAY}:4:0:0"), ("😄", f"jn:m:{DAY}:5:0:0")]


def saved(mood=None, text="", previous=None):
    entry = {"mood": mood, "text": text} if mood or text else None
    return {**CARD, "entry": entry, "previous": previous}


# --- texts --------------------------------------------------------------------------------------


def test_the_question_card():
    assert question_text(CARD) == "🌙 <b>How was today?</b>\n<i>Wednesday 25 Nov · tap a face</i>"
    assert buttons(question_keyboard(CARD)) == [*FACES, ("↗ Open", URL)]
    yesterday = {**CARD, "today": "2026-11-26", "entry": {"mood": 2, "text": "Rain & <wind>"}}
    assert question_text(yesterday) == "🌙 <b>How was Wednesday 25 Nov?</b>\n<i>Tap a face</i>\nNow: 🙁 Rain &amp; &lt;wind&gt;"
    assert len(JournalCb(action="s", d=DAY, p=2**31, c=2**31).pack().encode()) <= 64


def test_the_prompt_names_its_day_so_a_reply_finds_it_after_a_restart():
    text = prompt_text(CARD)
    assert text.startswith("<b>✍️ One line about Wed 25 Nov 2026</b>")
    plain = text.replace("<b>", "").replace("</b>", "").replace("<i>", "").replace("</i>", "")
    assert prompt_day(plain) == DAY
    assert prompt_day("✍️ One line about Thu 5 Mar 2026") == "2026-03-05"
    assert prompt_day("✍️ One line about someday") is None
    assert prompt_day("📝 New note") is None


def test_saved_text():
    assert saved_text(saved(4, "Long <walk>")) == "📓 <b>Saved</b> · Wednesday 25 Nov\n🙂 Long &lt;walk&gt;"
    assert saved_text(saved()) == "📓 <b>Saved</b> · Wednesday 25 Nov"


# --- the flow ------------------------------------------------------------------------------------


def journal_tg(**overrides) -> Tg:
    return Tg(fake_api(**{"journal": AsyncMock(return_value=CARD), "journal_save": AsyncMock(), **overrides}))


async def test_journal_command_asks_the_question():
    tg = journal_tg()
    await tg.send("/journal")
    sent = tg.session.last("SendMessage")
    assert sent.text == question_text(CARD)
    assert buttons(sent.reply_markup)[:5] == FACES


async def test_a_face_saves_the_mood_and_asks_for_the_line():
    tg = journal_tg(journal_save=AsyncMock(return_value=saved(4, previous=None)))
    await tg.press(f"jn:m:{DAY}:4:0:0", message=bot_message(question_text(CARD), message_id=50))
    tg.api.journal_save.assert_awaited_once_with(DAY, mood=4)
    prompt = tg.session.last("SendMessage")
    assert prompt.text == prompt_text(CARD)
    assert isinstance(prompt.reply_markup, ForceReply)
    card = tg.session.last("EditMessageText")
    assert card.text.startswith("🙂 <b>Good</b> · Wednesday 25 Nov")
    # Skip names the prompt (FakeSession numbers sent messages from 1000), Undo the card.
    assert buttons(card.reply_markup) == [("⏭ Skip", f"jn:s:{DAY}:0:1000:0"), ("↩ Undo", f"jn:u:{DAY}:0:0:50")]
    assert tg.toast().text == "🙂 Good"


async def test_the_line_is_saved_from_a_reply_with_undo_and_open():
    tg = journal_tg(journal_save=AsyncMock(return_value=saved(4, previous=None)))
    await tg.press(f"jn:m:{DAY}:4:0:0", message=bot_message(question_text(CARD), message_id=50))
    tg.api.journal_save = AsyncMock(return_value=saved(4, "Long walk by the river", previous={"mood": 4, "text": ""}))
    await tg.send("Long   walk by\nthe river", reply_to=bot_message("✍️ One line about Wed 25 Nov 2026\nWhat stood out?", message_id=1000))
    tg.api.journal_save.assert_awaited_once_with(DAY, text="Long walk by the river")
    reply = tg.session.last("SendMessage")
    assert reply.text == "📓 <b>Saved</b> · Wednesday 25 Nov\n🙂 Long walk by the river"
    # Undo points at the card, whose snapshot is the day before the face.
    assert buttons(reply.reply_markup) == [("↩ Undo", f"jn:u:{DAY}:0:0:50"), ("↗ Open", URL)]
    # The card's Skip goes away: it has its answer.
    tidy = tg.session.last("EditMessageReplyMarkup")
    assert tidy.message_id == 50 and tidy.reply_markup is None


async def test_undo_puts_the_day_back_and_asks_again():
    tg = journal_tg(journal_save=AsyncMock(return_value=saved(4, previous=None)))
    await tg.press(f"jn:m:{DAY}:4:0:0", message=bot_message(question_text(CARD), message_id=50))
    # A second face on the same card keeps the first snapshot.
    tg.api.journal_save = AsyncMock(return_value=saved(5, previous={"mood": 4, "text": ""}))
    await tg.press(f"jn:m:{DAY}:5:0:0", message=bot_message("🙂 Good", message_id=50))
    tg.api.journal_save = AsyncMock(return_value=saved())
    await tg.press(f"jn:u:{DAY}:0:0:50", message=bot_message("📓 Saved", message_id=60))
    tg.api.journal_save.assert_awaited_once_with(DAY, mood=None, text="")
    edited = tg.session.last("EditMessageText")
    assert edited.text == question_text(CARD, footer="↩ Put back")
    assert buttons(edited.reply_markup)[:5] == FACES
    assert tg.toast().text == "↩ Put back"


async def test_undo_restores_an_earlier_entry():
    before = {"mood": 2, "text": "Written in the app"}
    tg = journal_tg(journal_save=AsyncMock(return_value=saved(4, "Written in the app", previous=before)))
    await tg.press(f"jn:m:{DAY}:4:0:0", message=bot_message(question_text(CARD), message_id=50))
    tg.api.journal_save = AsyncMock(return_value=saved(2, "Written in the app"))
    await tg.press(f"jn:u:{DAY}:0:0:50", message=bot_message("x", message_id=50))
    tg.api.journal_save.assert_awaited_once_with(DAY, mood=2, text="Written in the app")


async def test_undo_after_a_restart_says_so():
    tg = journal_tg()
    await tg.press(f"jn:u:{DAY}:0:0:50", message=bot_message("📓 Saved", message_id=60))
    toast = tg.toast()
    assert toast.text == CANT_UNDO and toast.show_alert is True
    tg.api.journal_save.assert_not_awaited()


async def test_a_reply_without_a_face_first_can_still_be_undone():
    tg = journal_tg(journal_save=AsyncMock(return_value=saved(None, "Just a line", previous=None)))
    await tg.send("Just a line", reply_to=bot_message("✍️ One line about Wed 25 Nov 2026"))
    reply = tg.session.last("SendMessage")
    # Undo keyed by the reply itself (message 1).
    assert buttons(reply.reply_markup)[0] == ("↩ Undo", f"jn:u:{DAY}:0:0:1")
    assert not tg.session.of("EditMessageReplyMarkup")


async def test_skip_takes_the_prompt_away_and_shows_what_was_saved():
    tg = journal_tg(journal=AsyncMock(return_value=saved(3)))
    await tg.press(f"jn:s:{DAY}:0:1000:0", message=bot_message("😐 Okay", message_id=50))
    assert tg.session.last("DeleteMessage").message_id == 1000
    tg.api.journal.assert_awaited_once_with(DAY)
    edited = tg.session.last("EditMessageText")
    assert edited.text == "📓 <b>Saved</b> · Wednesday 25 Nov\n😐"
    assert buttons(edited.reply_markup) == [("↩ Undo", f"jn:u:{DAY}:0:0:50"), ("↗ Open", URL)]


async def test_a_long_or_empty_reply_is_explained_and_not_saved():
    tg = journal_tg()
    await tg.send("x" * 501, reply_to=bot_message("✍️ One line about Wed 25 Nov 2026"))
    assert "501 characters" in tg.session.last("SendMessage").text
    await tg.send(None, reply_to=bot_message("✍️ One line about Wed 25 Nov 2026"), sticker={"file_id": "s", "file_unique_id": "s", "type": "regular", "width": 1, "height": 1, "is_animated": False, "is_video": False})
    assert "Send the line as text" in tg.session.last("SendMessage").text
    tg.api.journal_save.assert_not_awaited()


async def test_a_refused_line_shows_why():
    tg = journal_tg(journal_save=AsyncMock(side_effect=ApiError(422, "not_saved", "That day hasn't come yet.")))
    await tg.send("Tomorrow", reply_to=bot_message("✍️ One line about Wed 25 Nov 2026"))
    assert "That day hasn't come yet." in tg.session.last("SendMessage").text


async def test_other_replies_still_go_to_capture():
    tg = journal_tg()
    await tg.send("Milk", reply_to=bot_message("📝 New note\nWhat should it say?"))
    tg.api.capture.assert_awaited_once()
    tg.api.journal_save.assert_not_awaited()


async def test_journal_errors_offer_a_retry():
    tg = journal_tg(journal=AsyncMock(side_effect=ApiUnreachable("down")))
    await tg.send("/journal")
    assert buttons(tg.session.last("SendMessage").reply_markup) == [("🔄 Try again", "rt:journal:")]
    tg.api.journal = AsyncMock(return_value=CARD)
    await tg.press("rt:journal:", message=bot_message("error"))
    assert tg.session.last("EditMessageText").text == question_text(CARD)


async def test_journal_is_in_the_menu_and_help():
    assert "journal" in [c.command for c in app.COMMANDS]
    assert "/journal" in texts.HELP


# --- memory ------------------------------------------------------------------------------------------


def test_memory_keeps_the_first_snapshot_and_forgets_old_ones():
    memory = JournalMemory()
    memory.remember(50, DAY, None, now=0)
    memory.remember(50, DAY, {"mood": 4, "text": ""}, now=10)
    assert memory.snapshot(50, now=20) == (True, None)
    assert memory.card_for(DAY) == 50
    assert memory.snapshot(50, now=7 * 3600) == (False, None)
    assert memory.card_for(DAY) == 0


# --- the evening loop -----------------------------------------------------------------------------


class FakeBot:
    def __init__(self, fail: bool = False):
        self.sent: list[SimpleNamespace] = []
        self.fail = fail

    async def send_message(self, chat_id, text, reply_markup=None):
        if self.fail:
            raise RuntimeError("telegram down")
        self.sent.append(SimpleNamespace(text=text, reply_markup=reply_markup))
        return self.sent[-1]


def loop_api(due: dict | None = None, **overrides):
    api = SimpleNamespace(
        journal_due=AsyncMock(return_value=due if due is not None else {"due": True, "date": DAY, "time": "21:30", "card": CARD}),
        ack_journal=AsyncMock(return_value=1),
    )
    for name, value in overrides.items():
        setattr(api, name, value)
    return api


async def test_the_question_goes_out_when_due_then_is_acked():
    bot, api = FakeBot(), loop_api()
    assert await journal_once(bot, api, 42) is True
    assert bot.sent[0].text == question_text(CARD)
    assert buttons(bot.sent[0].reply_markup)[:5] == FACES
    api.ack_journal.assert_awaited_once_with(DAY)


async def test_nothing_when_not_due_and_no_repeat_when_the_ack_fails():
    bot = FakeBot()
    assert await journal_once(bot, loop_api({"due": False, "date": DAY, "time": "21:30", "card": None}), 42) is False
    assert bot.sent == []
    failing = loop_api(ack_journal=AsyncMock(side_effect=ApiUnreachable("down")))
    memory = JournalMemory()
    assert await journal_once(bot, failing, 42, memory) is True
    assert await journal_once(bot, failing, 42, memory) is False
    assert len(bot.sent) == 1
    unsent = loop_api()
    assert await journal_once(FakeBot(fail=True), unsent, 42) is False
    unsent.ack_journal.assert_not_awaited()
