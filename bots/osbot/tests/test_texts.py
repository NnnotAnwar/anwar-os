from datetime import UTC, date, datetime, timedelta

import pytest

from osbot import fmt, texts

NOW = datetime(2026, 11, 16, 12, 30, tzinfo=UTC)  # 13:30 in Prague


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


# --- formatting primitives ----------------------------------------------------------------


def test_escaping_and_truncation():
    assert fmt.esc("<b>Tom & Jerry</b>") == "&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;"
    assert fmt.truncate("a  very\nlong   title", 100) == "a very long title"
    assert fmt.truncate("abcdefghij", 6) == "abcde…"


def test_human_dates_in_prague():
    assert fmt.clock(NOW) == "13:30"
    today = date(2026, 11, 16)
    assert fmt.human_day(today, today) == "today"
    assert fmt.human_day(date(2026, 11, 17), today) == "tomorrow"
    assert fmt.human_day(date(2026, 11, 15), today) == "yesterday"
    assert fmt.human_day(date(2026, 11, 14), today) == "Sat 14 Nov"
    assert fmt.stamp(NOW - timedelta(hours=1), NOW) == "12:30"
    assert fmt.stamp(NOW - timedelta(days=1), NOW) == "yesterday 13:30"
    # 23:30 UTC is already tomorrow in Prague.
    assert fmt.today_local(datetime(2026, 11, 16, 23, 30, tzinfo=UTC)) == date(2026, 11, 17)


# --- messages ----------------------------------------------------------------------------------


def test_reminder_text():
    reminder = {"title": "Dentist", "location": "Vinohradská 1", "start": "2026-11-16T13:00:00.000Z", "allDay": False, "when": "14:00"}
    assert texts.reminder_text(reminder, NOW) == "⏰ <b>Dentist</b> in 30 min · 14:00\n📍 Vinohradská 1"
    assert texts.reminder_text({**reminder, "location": ""}, NOW) == "⏰ <b>Dentist</b> in 30 min · 14:00"
    assert texts.reminder_text({**reminder, "title": "<Lunch>"}, NOW, footer="💤 Snoozed").endswith("\n<i>💤 Snoozed</i>")
    assert "&lt;Lunch&gt;" in texts.reminder_text({**reminder, "title": "<Lunch>"}, NOW)


TODAY = {
    "date": "Monday 16 Nov",
    "events": [
        {"time": "All day", "title": "Mum's birthday", "location": ""},
        {"time": "14:00 – 15:00", "title": "Dentist", "location": "Vinohradská 1"},
    ],
    "tasks": [
        {"id": "a", "title": "Pay rent", "overdue": True, "dueDate": "2026-11-14", "time": None},
        {"id": "b", "title": "Call the bank", "overdue": False, "dueDate": "2026-11-16", "time": "10:00"},
        {"id": "c", "title": "Water <plants>", "overdue": False, "dueDate": "2026-11-16", "time": None},
    ],
    "tasksTotal": 5,
    "newFeedback": 2,
}


def test_today_text():
    assert texts.today_text(TODAY, NOW) == (
        "📅 <b>Monday 16 Nov</b>\n"
        "\n"
        "<b>Calendar</b>\n"
        "<code>All day      </code>  Mum's birthday\n"
        "<code>14:00 – 15:00</code>  Dentist · <i>Vinohradská 1</i>\n"
        "\n"
        "<b>Tasks</b> · 5 due\n"
        "<b>1.</b> Pay rent · <i>overdue · Sat 14 Nov</i>\n"
        "<b>2.</b> Call the bank · <i>10:00</i>\n"
        "<b>3.</b> Water &lt;plants&gt;\n"
        "<i>+2 more in the app</i>\n"
        "<i>Tap a number to open a task.</i>\n"
        "\n"
        "💬 2 new feedback messages"
    )


def test_today_empty_states_say_what_to_do():
    assert texts.today_text({"date": "Tuesday 17 Nov", "events": [], "newFeedback": 0}, NOW) == (
        "📅 <b>Tuesday 17 Nov</b>\n\n<b>Calendar</b>\n<i>Nothing in the calendar.</i>\n\n<b>Tasks</b>\n<i>Nothing due. Add one with /task.</i>"
    )


def test_today_pages():
    tasks = [{"id": str(n), "title": f"T{n}", "overdue": False, "dueDate": "2026-11-16", "time": None} for n in range(7)]
    second = texts.today_text({**TODAY, "tasks": tasks, "tasksTotal": 7}, NOW, page=1)
    assert "<b>6.</b> T5\n<b>7.</b> T6" in second and "<b>5.</b>" not in second
    # A page past the end shows the last one.
    assert texts.today_text({**TODAY, "tasks": tasks, "tasksTotal": 7}, NOW, page=9) == second


def test_a_packed_day_stays_short():
    events = [{"time": "09:00 – 10:00", "title": "x" * 200, "location": "y" * 100} for _ in range(40)]
    tasks = [{"id": str(n), "title": "t" * 300, "overdue": True, "dueDate": "2026-11-01", "time": None} for n in range(15)]
    text = texts.today_text({"date": "Monday 16 Nov", "events": events, "tasks": tasks, "tasksTotal": 99, "newFeedback": 3}, NOW)
    assert "+28 more in the calendar" in text and "+84 more in the app" in text
    assert len(text) < 4096


def test_task_cards():
    pay, bank = TODAY["tasks"][0], TODAY["tasks"][1]
    assert texts.task_card(pay, NOW) == "☐ <b>Pay rent</b>\n<i>Overdue · was due Sat 14 Nov</i>"
    assert texts.task_card(bank, NOW) == "☐ <b>Call the bank</b>\n<i>Due today at 10:00</i>"
    assert texts.task_done_card({"title": "Pay rent"}) == "✅ <s>Pay rent</s>\n<i>Done</i>"
    assert texts.task_done_card({"title": "Rent", "nextDue": "2026-12-14"}) == "✅ <s>Rent</s>\n<i>Done · next one Mon 14 Dec</i>"
    assert texts.task_moved_card({"title": "Pay rent", "dueDate": "2026-11-17"}, NOW) == "⏭ <b>Pay rent</b>\n<i>Moved to tomorrow · Tue 17 Nov</i>"


def test_feedback_text_and_footer():
    item = {"kindLabel": "Question", "message": "Does <it> work?", "name": None, "contact": "@jana", "createdAt": "2026-11-16T12:05:00Z"}
    text = texts.feedback_text(item, NOW)
    assert text == "💬 <b>New feedback</b> · Question\n<blockquote>Does &lt;it&gt; work?</blockquote>\n— Anonymous · @jana · <i>13:05</i>"
    assert "<blockquote expandable>" in texts.feedback_text({**item, "message": "x" * 500}, NOW)

    read = texts.with_feedback_footer(text, "read")
    assert read.endswith("\n\n<i>✓ Marked read</i>")
    assert texts.with_feedback_footer(read, "spam").endswith("</i>\n\n<i>🚫 Marked as spam</i>")
    assert texts.with_feedback_footer(read, "new") == text


def test_saved_text():
    assert texts.saved_text({"kind": "note", "title": "Milk"}) == "📝 <b>Note saved</b>\nMilk"
    assert texts.saved_text({"kind": "task", "title": "Call <bank>"}) == "✅ <b>Task added</b>\nCall &lt;bank&gt;"
    assert texts.saved_text({"kind": "inbox", "title": "x"}) == "📥 <b>Saved to Inbox</b>\nx"
    assert texts.saved_text({"kind": "journal", "title": "x"}, "Journal") == "📌 <b>Journal saved</b>\nx"
    assert texts.saved_text({"kind": "link", "title": "React", "duplicate": True}) == "🔗 <b>Already saved</b>\nReact"
    assert texts.saved_title("📝 Note saved\nMilk") == "Milk"


def test_prompts_round_trip():
    for key in texts.PROMPTS:
        plain = texts.prompt_text(key).replace("<b>", "").replace("</b>", "")
        assert texts.prompt_key(plain) == key
    assert texts.prompt_key("📅 Monday") is None
    assert texts.prompt_key(None) is None


def test_static_texts_fit_telegram_limits():
    assert len(texts.SHORT_DESCRIPTION) <= 120
    assert len(texts.DESCRIPTION) <= 512
    for toast in (texts.GONE, texts.STALE, texts.TOO_OLD, texts.UNDO_TOO_LATE, texts.CANT_SNOOZE, texts.SOMETHING_WRONG):
        assert len(toast) <= 200
