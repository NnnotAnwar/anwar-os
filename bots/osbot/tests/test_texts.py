from datetime import UTC, datetime, timedelta

import pytest

from osbot import texts

NOW = datetime(2026, 11, 16, 12, 30, tzinfo=UTC)


@pytest.mark.parametrize(
    ("minutes", "expected"),
    [
        (30, "in 30 min"),
        (1, "now"),
        (0, "now"),
        (-5, "started 5 min ago"),
        (-90, "started"),
        (60, "in 1 h"),
        (135, "in 2 h 15 min"),
        (1440, "in 1 day"),
        (2 * 1440, "in 2 days"),
    ],
)
def test_relative(minutes, expected):
    assert texts.relative(NOW + timedelta(minutes=minutes), NOW) == expected


def test_relative_all_day():
    assert texts.relative(NOW + timedelta(hours=10), NOW, all_day=True) == "today"
    assert texts.relative(NOW + timedelta(hours=20), NOW, all_day=True) == "tomorrow"
    assert texts.relative(NOW + timedelta(days=3), NOW, all_day=True) == "in 3 days"


def test_reminder_text():
    reminder = {
        "title": "Dentist",
        "location": "Vinohradská 1",
        "start": "2026-11-16T13:00:00.000Z",
        "allDay": False,
        "when": "14:00",
    }
    assert texts.reminder_text(reminder, NOW) == "⏰ Dentist in 30 min · 14:00\n📍 Vinohradská 1"
    assert texts.reminder_text({**reminder, "location": ""}, NOW) == "⏰ Dentist in 30 min · 14:00"


def test_today_text():
    data = {
        "date": "Monday 16 Nov",
        "events": [
            {"time": "All day", "title": "Mum's birthday", "location": ""},
            {"time": "14:00 – 15:00", "title": "Dentist", "location": "Vinohradská 1"},
        ],
        "tasks": [
            {"title": "Pay rent", "overdue": True, "time": None},
            {"title": "Call the bank", "overdue": False, "time": "10:00"},
            {"title": "Water plants", "overdue": False, "time": None},
        ],
        "tasksTotal": 5,
        "newFeedback": 2,
    }
    assert texts.today_text(data) == (
        "📅 Monday 16 Nov\n"
        "• All day  Mum's birthday\n"
        "• 14:00 – 15:00  Dentist · Vinohradská 1\n"
        "\n"
        "✅ Tasks\n"
        "• Pay rent · overdue\n"
        "• Call the bank · 10:00\n"
        "• Water plants · today\n"
        "… and 2 more\n"
        "\n"
        "💬 2 new feedback messages"
    )
    assert texts.today_text({"date": "Tuesday 17 Nov", "events": [], "newFeedback": 0}) == (
        "📅 Tuesday 17 Nov\nNothing in the calendar today."
    )


def test_feedback_text():
    item = {"kindLabel": "Question", "message": "Does it work?", "name": None, "contact": "@jana", "url": "https://x/app/feedback/1"}
    assert texts.feedback_text(item) == (
        "💬 New feedback · Question\n\nDoes it work?\n\n— Anonymous · @jana\nhttps://x/app/feedback/1"
    )


def test_saved_text():
    assert texts.saved_text({"kind": "note", "title": "Milk", "url": "https://x/app/notes/1"}) == (
        "✅ Note saved: Milk\nhttps://x/app/notes/1"
    )
    assert texts.saved_text({"kind": "link", "title": "React", "url": "", "duplicate": True}) == "Already saved: React"
