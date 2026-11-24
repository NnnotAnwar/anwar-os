"""Handlers end to end through the real Dispatcher (Telegram and the web API faked)."""

from __future__ import annotations

import time
from datetime import UTC, datetime
from unittest.mock import AsyncMock

from aiogram.exceptions import TelegramBadRequest
from aiogram.methods import SendMessage
from aiogram.types import ForceReply, MessageEntity, ReplyKeyboardMarkup

from osbot import texts
from osbot.api import ApiError, ApiUnreachable
from osbot.handlers.common import message_content, without_command
from osbot.keyboards import UNDO_WINDOW_SECONDS, UndoCaptureCb

from .conftest import FEEDBACK_ID, NOTE_ID, OWNER, SAVED, TASK_ID, TODAY, Tg, bot_message, buttons, fake_api, user_message

# --- content extraction -------------------------------------------------------------


def test_message_content_finds_plain_hidden_and_caption_links():
    from types import SimpleNamespace

    def msg(text=None, caption=None, entities=None):
        return SimpleNamespace(text=text, caption=caption, entities=entities, caption_entities=None)

    text = "Read this: https://react.dev/learn now"
    assert message_content(msg(text, entities=[MessageEntity(type="url", offset=11, length=23)])) == (text, "https://react.dev/learn")
    hidden = MessageEntity(type="text_link", offset=0, length=4, url="https://hidden.example/post")
    assert message_content(msg("This post", entities=[hidden])) == ("This post", "https://hidden.example/post")
    assert message_content(msg(caption="photo of https://a.example")) == ("photo of https://a.example", "https://a.example")
    assert message_content(msg("no links")) == ("no links", None)


def test_without_command():
    assert without_command("/note Milk and bread") == "Milk and bread"
    assert without_command("/note@anwarosbot Milk") == "Milk"
    assert without_command("Milk /note") == "Milk /note"


# --- first contact ---------------------------------------------------------------------


async def test_start_welcomes_and_sets_the_main_menu(tg: Tg):
    await tg.send("/start")
    sent = tg.session.last("SendMessage")
    assert sent.text == texts.WELCOME
    assert isinstance(sent.reply_markup, ReplyKeyboardMarkup)
    assert [b.text for b in sent.reply_markup.keyboard[0]] == ["📅 Today", "➕ Task", "❓ Help"]
    assert sent.reply_markup.is_persistent and sent.reply_markup.input_field_placeholder == texts.PLACEHOLDER


async def test_help_from_command_and_menu(tg: Tg):
    await tg.send("/help")
    await tg.send("❓ Help")
    helps = tg.session.of("SendMessage")
    assert [m.text for m in helps] == [texts.HELP, texts.HELP]
    assert buttons(helps[0].reply_markup) == [("📅 Today", "m:today"), ("↗ Open anwar.os", "https://os.example")]


async def test_unknown_commands_point_to_help(tg: Tg):
    await tg.send("/frobnicate")
    assert tg.session.last("SendMessage").text == texts.UNKNOWN_COMMAND
    tg.api.capture.assert_not_awaited()


async def test_strangers_are_refused(tg: Tg):
    await tg.send("/today", chat_id=7)
    assert tg.session.last("SendMessage").text == texts.NOT_OWNER
    tg.api.today.assert_not_awaited()


# --- /today ---------------------------------------------------------------------------------


async def test_today_shows_the_agenda_with_task_buttons(tg: Tg):
    await tg.send("📅 Today")
    assert tg.session.of("SendChatAction")  # typing… while the API answers
    sent = tg.session.last("SendMessage")
    assert sent.text.startswith("📅 <b>Monday 16 Nov</b>")
    assert buttons(sent.reply_markup) == [
        ("1", f"tk:open:{TASK_ID}:0:"),
        ("2", f"tk:open:{TODAY['tasks'][1]['id']}:0:"),
        ("🔄 Refresh", "td:0"),
        ("↗ Calendar", "https://os.example/app/calendar"),
        ("↗ Tasks", "https://os.example/app/tasks"),
    ]


async def test_today_paginates_long_task_lists(tg: Tg):
    tasks = [{**TODAY["tasks"][1], "id": f"{n:08d}-1111-4111-8111-111111111111", "title": f"Task {n}"} for n in range(12)]
    tg.api.today = AsyncMock(return_value={**TODAY, "tasks": tasks, "tasksTotal": 20})
    await tg.press("td:1", message=bot_message("old list"))
    edited = tg.session.last("EditMessageText")
    assert "<b>6.</b> Task 5" in edited.text and "<b>11.</b>" not in edited.text
    assert "+8 more in the app" in edited.text
    labels = [b[0] for b in buttons(edited.reply_markup)]
    assert labels[:5] == ["6", "7", "8", "9", "10"]
    assert labels[5:8] == ["‹ Prev", "2 / 3", "Next ›"]
    assert tg.toast().text is None


async def test_today_errors_are_specific_and_retryable(tg: Tg):
    tg.api.today = AsyncMock(side_effect=ApiUnreachable("refused"))
    await tg.send("/today")
    sent = tg.session.last("SendMessage")
    assert sent.text.startswith("<b>⚠️ anwar.os isn't answering</b>")
    assert buttons(sent.reply_markup) == [("🔄 Try again", "rt:today:")]

    tg.api.today = AsyncMock(side_effect=ApiError(401, "unauthorized"))
    await tg.send("/today")
    sent = tg.session.last("SendMessage")
    assert "refused my signature" in sent.text and sent.reply_markup is None

    tg.api.today = AsyncMock(return_value=TODAY)
    await tg.press("rt:today:", message=bot_message("error"))
    assert tg.session.last("EditMessageText").text.startswith("📅 <b>Monday 16 Nov</b>")


async def test_task_card_done_and_undo(tg: Tg):
    await tg.press(f"tk:open:{TASK_ID}:0:")
    card = tg.session.last("EditMessageText")
    assert card.text == "☐ <b>Pay rent</b>\n<i>Overdue · was due Sat 14 Nov</i>"
    assert buttons(card.reply_markup) == [
        ("✓ Done", f"tk:done:{TASK_ID}:0:"),
        ("⏭ Tomorrow", f"tk:tmr:{TASK_ID}:0:"),
        ("↗ Open in app", f"https://os.example/app/tasks?task={TASK_ID}"),
        ("‹ Back", "td:0"),
    ]

    snapshot = {"id": TASK_ID, "title": "Pay rent", "done": True, "dueDate": "2026-11-14", "dueTime": None, "overdue": False, "url": "u", "previousDueDate": "2026-11-14", "nextDue": None}
    tg.api.task_action = AsyncMock(return_value=snapshot)
    await tg.press(f"tk:done:{TASK_ID}:0:")
    tg.api.task_action.assert_awaited_once_with(TASK_ID, "complete", None)
    assert tg.session.last("EditMessageText").text == "✅ <s>Pay rent</s>\n<i>Done</i>"
    assert buttons(tg.session.last("EditMessageText").reply_markup) == [("↩ Undo", f"tk:undone:{TASK_ID}:0:"), ("‹ Back", "td:0")]
    assert tg.toast().text == "✅ Done"

    tg.api.task_action = AsyncMock(return_value={**snapshot, "done": False, "overdue": True})
    await tg.press(f"tk:undone:{TASK_ID}:0:")
    tg.api.task_action.assert_awaited_once_with(TASK_ID, "reopen", None)
    assert tg.session.last("EditMessageText").text.startswith("☐ <b>Pay rent</b>")


async def test_postpone_and_undo_restore_the_old_date(tg: Tg):
    moved = {"id": TASK_ID, "title": "Pay rent", "done": False, "dueDate": "2026-11-17", "dueTime": None, "overdue": False, "url": "u", "previousDueDate": "2026-11-14", "nextDue": None}
    tg.api.task_action = AsyncMock(return_value=moved)
    await tg.press(f"tk:tmr:{TASK_ID}:1:")
    tg.api.task_action.assert_awaited_once_with(TASK_ID, "postpone", None)
    assert buttons(tg.session.last("EditMessageText").reply_markup)[0] == ("↩ Undo", f"tk:due:{TASK_ID}:1:2026-11-14")

    await tg.press(f"tk:due:{TASK_ID}:1:2026-11-14")
    tg.api.task_action.assert_awaited_with(TASK_ID, "schedule", "2026-11-14")
    await tg.press(f"tk:due:{TASK_ID}:1:-")
    tg.api.task_action.assert_awaited_with(TASK_ID, "schedule", None)


async def test_a_task_gone_meanwhile_refreshes_the_list(tg: Tg):
    tg.api.task_action = AsyncMock(side_effect=ApiError(404, "gone", "That task no longer exists."))
    await tg.press(f"tk:done:{TASK_ID}:0:")
    assert tg.session.last("EditMessageText").text.startswith("📅 <b>Monday 16 Nov</b>")
    assert "no longer exists" in tg.toast().text

    tg.api.today = AsyncMock(return_value={**TODAY, "tasks": []})
    await tg.press(f"tk:open:{TASK_ID}:0:")
    assert tg.toast().text == "That task isn't due today any more."
    assert "Nothing due" in tg.session.last("EditMessageText").text


# --- capture -------------------------------------------------------------------------------


async def test_any_message_offers_destinations(tg: Tg):
    await tg.send("Remember the milk")
    sent = tg.session.last("SendMessage")
    assert sent.text == texts.ASK_TARGET
    assert sent.reply_parameters.message_id == 1  # a reply: the buttons read the original back
    assert buttons(sent.reply_markup) == [
        ("📥 Inbox", "cap:inbox"),
        ("✅ Task", "cap:task"),
        ("📝 Note", "cap:note"),
        ("💡 Idea", "cap:idea"),
        ("✕ Cancel", "x"),
    ]


async def test_a_url_gets_the_link_button_first(tg: Tg):
    await tg.send("https://react.dev/learn", entities=[{"type": "url", "offset": 0, "length": 23}])
    assert buttons(tg.session.last("SendMessage").reply_markup)[0] == ("🔗 Link", "cap:link")


async def test_messages_without_text_are_explained(tg: Tg):
    await tg.send(sticker={"file_id": "s", "file_unique_id": "u", "type": "regular", "width": 1, "height": 1, "is_animated": False, "is_video": False})
    assert tg.session.last("SendMessage").text == texts.NOTHING_TO_SAVE


async def test_a_destination_button_saves_and_offers_open_and_undo(tg: Tg):
    original = user_message("Look https://a.example/x", entities=[{"type": "url", "offset": 5, "length": 19}])
    await tg.press("cap:link", message=bot_message(texts.ASK_TARGET, reply_to=original))
    tg.api.capture.assert_awaited_once_with("link", "Look https://a.example/x", "https://a.example/x")
    card = tg.session.last("EditMessageText")
    assert card.text == "📝 <b>Note saved</b>\nMilk"
    labels = buttons(card.reply_markup)
    assert labels[0] == ("↗ Open", SAVED["url"])
    assert labels[1][0] == "↩ Undo" and labels[1][1].startswith(f"cu:note:{NOTE_ID}:")
    assert tg.toast().text is None


async def test_note_button_doesnt_send_the_url_separately(tg: Tg):
    await tg.press("cap:note", message=bot_message(texts.ASK_TARGET, reply_to=user_message("Look https://a.example/x")))
    tg.api.capture.assert_awaited_once_with("note", "Look https://a.example/x", None)


async def test_a_failed_save_keeps_the_choices(tg: Tg):
    tg.api.capture = AsyncMock(side_effect=ApiError(500, "internal"))
    await tg.press("cap:note", message=bot_message(texts.ASK_TARGET, reply_to=user_message("text")))
    assert not tg.session.of("EditMessageText")
    assert tg.toast().show_alert is True and "Something broke on anwar.os" in tg.toast().text


async def test_a_button_whose_original_is_gone(tg: Tg):
    await tg.press("cap:note", message=bot_message(texts.ASK_TARGET))
    tg.api.capture.assert_not_awaited()
    assert tg.toast().text == texts.GONE


async def test_cancel_deletes_the_prompt(tg: Tg):
    await tg.press("x", message=bot_message(texts.ASK_TARGET, reply_to=user_message("text")))
    assert tg.session.of("DeleteMessage")
    assert tg.toast().text == texts.CANCELLED


async def test_undo_removes_and_offers_the_destinations_again(tg: Tg):
    data = UndoCaptureCb(kind="note", id=NOTE_ID, at=int(time.time())).pack()
    await tg.press(data, message=bot_message("📝 Note saved\nMilk", reply_to=user_message("Milk")))
    tg.api.undo_capture.assert_awaited_once_with("note", NOTE_ID)
    card = tg.session.last("EditMessageText")
    assert card.text == texts.removed_text(offer_again=True)
    assert ("📝 Note", "cap:note") in buttons(card.reply_markup)


async def test_undo_after_a_command_just_says_removed(tg: Tg):
    data = UndoCaptureCb(kind="note", id=NOTE_ID, at=int(time.time())).pack()
    await tg.press(data, message=bot_message("📝 Note saved\nMilk", reply_to=user_message("/note Milk")))
    assert tg.session.last("EditMessageText").text == "↩ <b>Removed</b>\n<s>Milk</s>"


async def test_undo_expires(tg: Tg):
    data = UndoCaptureCb(kind="note", id=NOTE_ID, at=int(time.time()) - UNDO_WINDOW_SECONDS - 5).pack()
    message = bot_message(
        "📝 Note saved\nMilk",
        reply_markup={"inline_keyboard": [[{"text": "↗ Open", "url": "https://os.example/app/notes/1"}, {"text": "↩ Undo", "callback_data": data}]]},
    )
    await tg.press(data, message=message)
    tg.api.undo_capture.assert_not_awaited()
    assert tg.toast().text == texts.UNDO_TOO_LATE
    assert buttons(tg.session.last("EditMessageReplyMarkup").reply_markup) == [("↗ Open", "https://os.example/app/notes/1")]


async def test_commands_save_straight_away_as_a_reply(tg: Tg):
    await tg.send("/note Milk")
    tg.api.capture.assert_awaited_once_with("note", "Milk", None)
    sent = tg.session.last("SendMessage")
    assert sent.text == "📝 <b>Note saved</b>\nMilk"
    assert sent.reply_parameters.message_id == 1

    tg.api.capture.reset_mock()
    await tg.send("/link https://react.dev/learn great docs")
    tg.api.capture.assert_awaited_once_with("link", "https://react.dev/learn great docs", "https://react.dev/learn")

    tg.api.capture.reset_mock()
    await tg.send("/save Something")
    tg.api.capture.assert_awaited_once_with("inbox", "Something", None)


async def test_link_without_a_link_is_refused_locally(tg: Tg):
    await tg.send("/link hello")
    tg.api.capture.assert_not_awaited()
    assert "not a link" in tg.session.last("SendMessage").text


async def test_commands_without_text_ask_for_it(tg: Tg):
    await tg.send("/task")
    sent = tg.session.last("SendMessage")
    assert sent.text == texts.prompt_text("task")
    assert isinstance(sent.reply_markup, ForceReply)

    await tg.send("➕ Task")
    assert tg.session.last("SendMessage").text == texts.prompt_text("task")


async def test_answers_to_a_prompt_are_saved_as_that_kind(tg: Tg):
    prompt = bot_message("✅ New task\nWhat needs doing?")
    await tg.send("Call the bank tomorrow 10:00", reply_to=prompt)
    tg.api.capture.assert_awaited_once_with("task", "Call the bank tomorrow 10:00", None)

    # A reply to anything else is just a message to capture.
    tg.api.capture.reset_mock()
    await tg.send("hello", reply_to=bot_message("📅 Monday"))
    tg.api.capture.assert_not_awaited()
    assert tg.session.last("SendMessage").text == texts.ASK_TARGET


async def test_failed_command_saves_can_be_retried(tg: Tg):
    tg.api.capture = AsyncMock(side_effect=ApiUnreachable("timeout"))
    await tg.send("/note Milk")
    error = tg.session.last("SendMessage")
    assert "isn't answering" in error.text
    assert buttons(error.reply_markup) == [("🔄 Try again", "rt:cap:note")]

    tg.api.capture = AsyncMock(return_value=SAVED)
    await tg.press("rt:cap:note", message=bot_message(error.text, reply_to=user_message("/note Milk")))
    tg.api.capture.assert_awaited_once_with("note", "Milk", None)
    assert tg.session.last("EditMessageText").text == "📝 <b>Note saved</b>\nMilk"


async def test_bad_input_shows_the_apps_explanation_without_retry(tg: Tg):
    tg.api.capture = AsyncMock(side_effect=ApiError(422, "not_captured", "Nothing to save: send some text."))
    await tg.send("/note x")
    sent = tg.session.last("SendMessage")
    assert sent.text == "<b>✋ Nothing to save: send some text.</b>"
    assert sent.reply_markup is None


# --- reminders and feedback ------------------------------------------------------------------

REMINDER = {
    "eventId": "e1",
    "title": "Dentist",
    "location": "",
    "allDay": False,
    "start": "2026-11-16T13:00:00.000Z",
    "when": "14:00",
    "url": "https://os.example/app/calendar?event=e1",
}
NOW = datetime(2026, 11, 16, 12, 30, tzinfo=UTC)


async def test_reminder_got_it_drops_the_action_buttons(tg: Tg):
    card = bot_message(
        "⏰ Dentist in 30 min · 14:00",
        reply_markup={"inline_keyboard": [[{"text": "✓ Got it", "callback_data": "rm:ok:0"}], [{"text": "↗ Open in calendar", "url": REMINDER["url"]}]]},
    )
    await tg.press("rm:ok:0", message=card)
    assert buttons(tg.session.last("EditMessageReplyMarkup").reply_markup) == [("↗ Open in calendar", REMINDER["url"])]
    assert tg.toast().text == "👍 Got it"


async def test_reminder_snooze_queues_it_again(tg: Tg, monkeypatch):
    tg.reminders.remember(50, REMINDER)
    card = bot_message("⏰ Dentist in 30 min · 14:00", message_id=50)
    await tg.press("rm:snz:10", message=card)
    assert "Snoozed until" in tg.session.last("EditMessageText").text
    assert tg.toast().text.startswith("💤 I'll remind you again at ")
    assert len(tg.reminders) == 1


async def test_reminder_snooze_after_a_restart_says_so(tg: Tg):
    await tg.press("rm:snz:10", message=bot_message("⏰ Dentist", message_id=51))
    assert tg.toast().text == texts.CANT_SNOOZE and tg.toast().show_alert


async def test_feedback_mark_read_and_undo(tg: Tg):
    tg.api.feedback_status = AsyncMock(return_value={"id": FEEDBACK_ID, "status": "read", "previous": "new"})
    card = bot_message(
        "💬 New feedback · Question\nDoes it work?\n— Jana",
        entities=[{"type": "bold", "offset": 3, "length": 12}],
        reply_markup={"inline_keyboard": [[{"text": "↗ Open", "url": "https://os.example/app/feedback/1"}]]},
    )
    await tg.press(f"fb:{FEEDBACK_ID}:read", message=card)
    tg.api.feedback_status.assert_awaited_once_with(FEEDBACK_ID, "read")
    edited = tg.session.last("EditMessageText")
    assert edited.text.endswith("\n\n<i>✓ Marked read</i>")
    assert edited.text.startswith("💬 <b>New feedback</b>")
    assert buttons(edited.reply_markup) == [("↗ Open", "https://os.example/app/feedback/1"), ("↩ Undo", f"fb:{FEEDBACK_ID}:new")]
    assert tg.toast().text == "✓ Marked read"


async def test_feedback_that_is_gone(tg: Tg):
    tg.api.feedback_status = AsyncMock(side_effect=ApiError(404, "gone", "That feedback no longer exists."))
    await tg.press(f"fb:{FEEDBACK_ID}:read")
    assert tg.toast().show_alert and "no longer exists" in tg.toast().text


async def test_contact_replied_and_undo(tg: Tg):
    tg.api.contact_status = AsyncMock(return_value={"id": FEEDBACK_ID, "status": "replied", "previous": "new"})
    card = bot_message(
        "✉️ New contact · Job offer\nJana\njana@example.com\nWe're hiring\nReply by email",
        entities=[{"type": "bold", "offset": 3, "length": 11}],
        reply_markup={"inline_keyboard": [[{"text": "↗ Open", "url": "https://os.example/app/feedback/contact/1"}]]},
    )
    await tg.press(f"ct:{FEEDBACK_ID}:replied", message=card)
    tg.api.contact_status.assert_awaited_once_with(FEEDBACK_ID, "replied")
    edited = tg.session.last("EditMessageText")
    assert edited.text.startswith("✉️ <b>New contact</b>")
    assert edited.text.endswith("\n\n<i>✓ Marked replied</i>")
    assert buttons(edited.reply_markup) == [
        ("↗ Open", "https://os.example/app/feedback/contact/1"),
        ("↩ Undo", f"ct:{FEEDBACK_ID}:new"),
    ]
    assert tg.toast().text == "✓ Marked replied"


async def test_contact_that_is_gone(tg: Tg):
    tg.api.contact_status = AsyncMock(side_effect=ApiError(404, "gone", "That message no longer exists."))
    await tg.press(f"ct:{FEEDBACK_ID}:archived")
    assert tg.toast().show_alert and "no longer exists" in tg.toast().text


# --- stale buttons and errors -------------------------------------------------------------------


async def test_unknown_buttons_expire_politely(tg: Tg):
    await tg.press("something:old")
    assert tg.toast().text == texts.STALE


async def test_inaccessible_messages_are_handled(tg: Tg):
    inaccessible = {"message_id": 9, "date": 0, "chat": {"id": OWNER, "type": "private"}}
    await tg.press(f"tk:open:{TASK_ID}:0:", message=inaccessible)
    assert tg.toast().text == texts.STALE
    tg.api.today.assert_not_awaited()


async def test_a_crashing_handler_still_answers_the_button():
    tg = Tg(fake_api(today=AsyncMock(return_value={"broken": True})))
    await tg.press("td:0")
    assert tg.toast().text == texts.SOMETHING_WRONG


async def test_editing_with_the_same_content_is_fine(tg: Tg):
    tg.session.fail["EditMessageText"] = TelegramBadRequest(method=SendMessage(chat_id=1, text="x"), message="Bad Request: message is not modified")
    await tg.press("td:0")
    assert tg.toast().text is None  # answered normally, no error
