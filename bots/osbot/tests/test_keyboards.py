"""Keyboards, callback data, error descriptions and the snooze memory."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from osbot import keyboards as kb
from osbot.api import ApiError, ApiUnreachable
from osbot.errors import describe
from osbot.snooze import ReminderMemory, snooze_options
from osbot.targets import FALLBACK

from .conftest import TASK_ID, buttons

NOW = datetime(2026, 11, 16, 12, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    ("url", "ok"),
    [
        ("https://anwar-os.com/app/notes/1", True),
        ("http://example.org/x", True),
        ("http://localhost:3000/app", False),
        ("http://web:3000/app", False),
        ("http://127.0.0.1:3000/app", False),
        ("https://app.localhost/x", False),
        ("javascript:alert(1)", False),
        ("", False),
        (None, False),
    ],
)
def test_only_public_urls_become_buttons(url, ok):
    assert kb.linkable(url) is ok
    assert (kb.url_button("↗ Open", url) is not None) is ok


def test_callback_data_fits_telegrams_64_bytes():
    longest = [
        kb.TaskCb(action="undone", id=TASK_ID, page=99, due="2026-11-16"),
        kb.UndoCaptureCb(kind="inbox", id=TASK_ID, at=4_102_444_800),
        kb.FeedbackCb(id=TASK_ID, status="in_progress"),
    ]
    assert all(len(cb.pack().encode()) <= 64 for cb in longest)
    # The capture buttons keep their pre-redesign format, so old prompts still work.
    assert kb.CaptureCb(kind="note").pack() == "cap:note"


def test_capture_keyboard_orders_link_first_and_ends_with_cancel():
    assert buttons(kb.capture_keyboard(FALLBACK, has_url=True)) == [
        ("🔗 Link", "cap:link"),
        ("📥 Inbox", "cap:inbox"),
        ("✅ Task", "cap:task"),
        ("📝 Note", "cap:note"),
        ("💡 Idea", "cap:idea"),
        ("✕ Cancel", "x"),
    ]


def test_saved_keyboard():
    result = {"kind": "note", "id": TASK_ID, "url": "https://os.example/app/notes/1", "duplicate": False}
    assert buttons(kb.saved_keyboard(result, now=1000)) == [("↗ Open", result["url"]), ("↩ Undo", f"cu:note:{TASK_ID}:1000")]
    # A link saved before: Undo would delete the old one.
    assert buttons(kb.saved_keyboard({**result, "duplicate": True})) == [("↗ Open", result["url"])]
    # Inbox in dev (no public URL): just Undo.
    assert buttons(kb.saved_keyboard({**result, "url": "http://localhost:3000/app/inbox"}, now=1)) == [("↩ Undo", f"cu:note:{TASK_ID}:1")]
    assert kb.saved_keyboard({"kind": "x" * 40, "id": TASK_ID, "url": ""}) is None


def test_only_links_keeps_url_buttons():
    markup = kb.feedback_keyboard("f1", "https://os.example/app/feedback/f1")
    assert buttons(kb.only_links(markup)) == [("↗ Open", "https://os.example/app/feedback/f1")]
    assert kb.only_links(kb.retry_keyboard(kb.RetryCb(what="today"))) is None


def test_feedback_keyboard_states():
    assert [b[0] for b in buttons(kb.feedback_keyboard("f1", None))] == ["✓ Mark read", "🚫 Spam"]
    assert buttons(kb.feedback_keyboard("f1", None, "read", "new")) == [("↩ Undo", "fb:f1:new")]


def test_task_keyboards():
    task = {"id": TASK_ID, "url": "https://os.example/app/tasks?task=1", "previousDueDate": None}
    assert [b[0] for b in buttons(kb.task_keyboard(task, 0))] == ["✓ Done", "⏭ Tomorrow", "↗ Open in app", "‹ Back"]
    assert buttons(kb.task_moved_keyboard(task, 2))[0] == ("↩ Undo", f"tk:due:{TASK_ID}:2:-")


# --- errors ------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("error", "kind", "retry"),
    [
        (ApiUnreachable("refused"), "unreachable", True),
        (ApiError(401, "unauthorized"), "auth", False),
        (ApiError(404, "not_found"), "disabled", False),
        (ApiError(404, "error"), "outdated", False),
        (ApiError(404, "gone", "That task no longer exists."), "gone", False),
        (ApiError(413, "too_large"), "input", False),
        (ApiError(422, "not_captured", "No link found."), "input", False),
        (ApiError(503, "no_owner", "No owner account yet."), "auth", False),
        (ApiError(500, "internal"), "server", True),
        (KeyError("tasks"), "bug", True),
    ],
)
def test_errors_are_sorted_into_what_the_owner_can_do(error, kind, retry):
    problem = describe(error)
    assert (problem.kind, problem.retry) == (kind, retry)
    assert len(problem.toast()) <= 200
    assert problem.html().startswith("<b>")


def test_input_errors_show_the_apps_message():
    assert describe(ApiError(422, "not_captured", "No link found. <x>")).html() == "<b>✋ No link found. &lt;x&gt;</b>"


# --- snooze ---------------------------------------------------------------------------------


def test_snooze_options_end_before_the_event():
    reminder = {"start": (NOW + timedelta(minutes=30)).isoformat(), "allDay": False}
    assert snooze_options(reminder, NOW) == [10]
    assert snooze_options({**reminder, "start": (NOW + timedelta(hours=3)).isoformat()}, NOW) == [10, 60]
    assert snooze_options({**reminder, "start": (NOW + timedelta(minutes=5)).isoformat()}, NOW) == []
    assert snooze_options({**reminder, "allDay": True}, NOW) == [10, 60]


def test_reminder_memory_is_bounded():
    memory = ReminderMemory(keep_sent=2, keep_snoozed=2)
    for n in range(3):
        memory.remember(n, {"title": str(n), "keys": ["k"]})
    assert memory.get(0) is None and memory.get(2)["title"] == "2"
    for n in range(3):
        memory.snooze({"title": str(n)}, NOW + timedelta(minutes=n))
    assert len(memory) == 2
    assert [r["title"] for r in memory.due(NOW + timedelta(hours=1))] == ["0", "1"]
    assert len(memory) == 0
