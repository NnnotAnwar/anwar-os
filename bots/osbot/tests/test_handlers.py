"""Handlers with mocked Telegram objects and a mocked API (no network)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.filters import CommandObject
from aiogram.types import MessageEntity

from osbot.api import ApiError
from osbot.handlers import capture, commands
from osbot.handlers.common import message_content
from osbot.targets import CaptureTargets, Target

SAVED = {"kind": "note", "id": "1", "title": "Milk", "url": "https://os/app/notes/1", "duplicate": False}


def fake_message(text=None, *, caption=None, entities=None, reply_to=None):
    return SimpleNamespace(
        text=text,
        caption=caption,
        entities=entities,
        caption_entities=None,
        reply_to_message=reply_to,
        answer=AsyncMock(),
        reply=AsyncMock(),
        edit_text=AsyncMock(),
    )


def fake_api(**overrides):
    api = SimpleNamespace(
        capture=AsyncMock(return_value=SAVED),
        today=AsyncMock(return_value={"date": "Monday 16 Nov", "events": [], "newFeedback": 0}),
        capture_targets=AsyncMock(
            return_value={
                "default": "inbox",
                "targets": [
                    {"kind": "inbox", "label": "Inbox", "button": "Save to Inbox", "needsUrl": False},
                    {"kind": "note", "label": "Note", "button": "Save as note", "needsUrl": False},
                    {"kind": "link", "label": "Link", "button": "Save as link", "needsUrl": True},
                    {"kind": "idea", "label": "Idea", "button": "Save as idea", "needsUrl": False},
                ],
            }
        ),
    )
    for name, value in overrides.items():
        setattr(api, name, value)
    return api


def command(name, args=None):
    return CommandObject(prefix="/", command=name, args=args)


def buttons(markup):
    return [(b.text, b.callback_data) for row in markup.inline_keyboard for b in row]


# --- content extraction -------------------------------------------------------


def test_message_content_finds_plain_hidden_and_caption_links():
    text = "Read this: https://react.dev/learn now"
    url_entity = MessageEntity(type="url", offset=11, length=23)
    assert message_content(fake_message(text, entities=[url_entity])) == (text, "https://react.dev/learn")

    hidden = MessageEntity(type="text_link", offset=0, length=4, url="https://hidden.example/post")
    assert message_content(fake_message("This post", entities=[hidden])) == ("This post", "https://hidden.example/post")

    assert message_content(fake_message(caption="photo of https://a.example")) == ("photo of https://a.example", "https://a.example")
    assert message_content(fake_message("no links")) == ("no links", None)


# --- commands -------------------------------------------------------------------


async def test_note_and_idea_save_through_the_api():
    api, message = fake_api(), fake_message("/note Milk")
    await commands.cmd_direct(message, command("note", "Milk"), api)
    api.capture.assert_awaited_once_with("note", "Milk", None)
    assert message.answer.call_args.args[0] == "✅ Note saved: Milk\nhttps://os/app/notes/1"

    api = fake_api()
    await commands.cmd_direct(fake_message(), command("idea", "  Plant bot  "), api)
    api.capture.assert_awaited_once_with("idea", "Plant bot", None)


async def test_commands_without_text_explain_usage():
    api, message = fake_api(), fake_message("/note")
    await commands.cmd_direct(message, command("note"), api)
    api.capture.assert_not_awaited()
    assert message.answer.call_args.args[0].startswith("Send /note followed by")

    message = fake_message("/link hello")
    await commands.cmd_link(message, command("link", "hello"), api)
    api.capture.assert_not_awaited()
    assert "Send /link" in message.answer.call_args.args[0]


async def test_link_passes_the_url():
    api = fake_api()
    await commands.cmd_link(fake_message(), command("link", "https://react.dev/learn great docs"), api)
    api.capture.assert_awaited_once_with("link", "https://react.dev/learn great docs", "https://react.dev/learn")


async def test_task_goes_straight_to_tasks():
    api = fake_api()
    await commands.cmd_direct(fake_message(), command("task", "Call the bank tomorrow !high"), api)
    api.capture.assert_awaited_once_with("task", "Call the bank tomorrow !high", None)


async def test_save_uses_the_default_target():
    api = fake_api()
    await commands.cmd_save(fake_message(), command("save", "Something"), api, CaptureTargets(api))
    api.capture.assert_awaited_once_with("inbox", "Something", None)


async def test_api_errors_are_explained():
    api = fake_api(capture=AsyncMock(side_effect=ApiError(422, "not_captured", "No link found.")))
    message = fake_message()
    await commands.cmd_direct(message, command("note", "x"), api)
    assert message.answer.call_args.args[0] == "❌ No link found."

    api = fake_api(today=AsyncMock(side_effect=OSError("connection refused")))
    message = fake_message()
    await commands.cmd_today(message, api)
    assert message.answer.call_args.args[0] == "❌ Couldn't reach anwar.os. Try again in a minute."


async def test_today():
    api, message = fake_api(), fake_message("/today")
    await commands.cmd_today(message, api)
    assert message.answer.call_args.args[0] == "📅 Monday 16 Nov\nNothing in the calendar today."


# --- quick capture ---------------------------------------------------------------


async def test_forwarded_text_gets_buttons_without_link():
    api, message = fake_api(), fake_message("Remember the milk")
    await capture.offer_capture(message, CaptureTargets(api))
    markup = message.reply.call_args.kwargs["reply_markup"]
    assert buttons(markup) == [("Save to Inbox", "cap:inbox"), ("Save as note", "cap:note"), ("Save as idea", "cap:idea")]


async def test_a_url_gets_the_link_button_first():
    api, message = fake_api(), fake_message("https://react.dev/learn")
    await capture.offer_capture(message, CaptureTargets(api))
    markup = message.reply.call_args.kwargs["reply_markup"]
    assert buttons(markup) == [
        ("Save as link", "cap:link"),
        ("Save to Inbox", "cap:inbox"),
        ("Save as note", "cap:note"),
        ("Save as idea", "cap:idea"),
    ]


async def test_targets_from_the_api_drive_the_buttons():
    api = fake_api(
        capture_targets=AsyncMock(
            return_value={
                "default": "journal",
                "targets": [{"kind": "journal", "label": "Journal", "button": "Save to journal", "needsUrl": False}],
            }
        )
    )
    message = fake_message("anything")
    targets = CaptureTargets(api)
    await capture.offer_capture(message, targets)
    assert buttons(message.reply.call_args.kwargs["reply_markup"]) == [("Save to journal", "cap:journal")]
    assert targets.default == "journal"


async def test_targets_fall_back_when_the_api_is_down():
    api = fake_api(capture_targets=AsyncMock(side_effect=OSError("down")))
    targets = CaptureTargets(api)
    assert [t.kind for t in await targets.get()] == ["inbox", "task", "note", "link", "idea"]
    assert targets.default == "inbox"


async def test_messages_without_text_are_explained():
    message = fake_message()  # a sticker
    await capture.offer_capture(message, CaptureTargets(fake_api()))
    message.answer.assert_awaited_once_with(capture.NOTHING_TO_SAVE)
    message.reply.assert_not_awaited()


async def test_button_saves_the_original_message():
    api = fake_api()
    targets = CaptureTargets(api)
    await targets.get()
    original = fake_message("Look https://a.example/x", entities=[MessageEntity(type="url", offset=5, length=19)])
    prompt = fake_message("Save this?", reply_to=original)
    callback = SimpleNamespace(data="cap:link", message=prompt, answer=AsyncMock())

    await capture.save_choice(callback, api, targets)

    api.capture.assert_awaited_once_with("link", "Look https://a.example/x", "https://a.example/x")
    assert prompt.edit_text.call_args.args[0].startswith("✅ Note saved")
    callback.answer.assert_awaited_once_with()


async def test_note_button_doesnt_send_the_url_separately():
    api = fake_api()
    targets = CaptureTargets(api)
    await targets.get()
    original = fake_message("Look https://a.example/x")
    callback = SimpleNamespace(data="cap:note", message=fake_message("Save this?", reply_to=original), answer=AsyncMock())
    await capture.save_choice(callback, api, targets)
    api.capture.assert_awaited_once_with("note", "Look https://a.example/x", None)


async def test_button_keeps_choices_when_saving_fails():
    api = fake_api(capture=AsyncMock(side_effect=ApiError(500, "internal")))
    prompt = fake_message("Save this?", reply_to=fake_message("text"))
    callback = SimpleNamespace(data="cap:note", message=prompt, answer=AsyncMock())
    await capture.save_choice(callback, api, CaptureTargets(api))
    prompt.edit_text.assert_not_awaited()
    assert callback.answer.call_args.kwargs["show_alert"] is True


async def test_button_without_the_original_message():
    callback = SimpleNamespace(data="cap:note", message=fake_message("Save this?"), answer=AsyncMock())
    api = fake_api()
    await capture.save_choice(callback, api, CaptureTargets(api))
    api.capture.assert_not_awaited()
    callback.answer.assert_awaited_once_with(capture.GONE, show_alert=True)


def test_targets_find():
    targets = CaptureTargets(fake_api())
    assert targets.find("link") == Target("link", "Link", "Save as link", needs_url=True)
    assert targets.find("nope") is None
