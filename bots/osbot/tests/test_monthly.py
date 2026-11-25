"""The monthly report: the card, the 1st-of-the-month schedule with its PDF and ack, and /month."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

from osbot.api import ApiUnreachable
from osbot.monthly import MonthlyMemory, monthly_keyboard, monthly_once, monthly_text, parse_month_arg, previous_month, report_time

from .conftest import Tg, bot_message, buttons, fake_api

CHAT = 42
NBSP = "\u00a0"

# 1 Dec 2026, 10:05 in Prague (UTC+1).
FIRST_MORNING = datetime(2026, 12, 1, 9, 5, tzinfo=UTC)
# 30 Nov 2026, 10:05 in Prague.
LAST_DAY = datetime(2026, 11, 30, 9, 5, tzinfo=UTC)

REPORT = {
    "month": "2026-11",
    "label": "November 2026",
    "previousMonth": "2026-10",
    "previousLabel": "October 2026",
    "today": "2026-12-01",
    "timezone": "Europe/Prague",
    "partial": False,
    "delivered": False,
    "url": "https://os.example/app/review?month=2026-11",
    "pdfUrl": "https://os.example/app/review/pdf?month=2026-11",
    "spending": {
        "currency": "CZK",
        "expenseMinor": 1240000,
        "previousExpenseMinor": 1000000,
        "incomeMinor": 5000000,
        "previousIncomeMinor": 5000000,
        "netMinor": 3760000,
        "categories": [
            {"name": "Groceries", "color": None, "amountMinor": 800000, "previousMinor": 600000},
            {"name": "Eating <out>", "color": None, "amountMinor": 300000, "previousMinor": 350000},
            {"name": "Transport", "color": None, "amountMinor": 140000, "previousMinor": 50000},
            {"name": "Travel", "color": None, "amountMinor": 0, "previousMinor": 200000},
        ],
        "changes": [
            {"name": "Travel", "color": None, "amountMinor": 0, "previousMinor": 200000},
            {"name": "Groceries", "color": None, "amountMinor": 800000, "previousMinor": 600000},
        ],
        "otherCurrencies": [{"currency": "EUR", "expenseMinor": 1299, "incomeMinor": 0}],
        "transactionCount": 42,
        "url": "",
    },
    "subscriptions": {"totals": [{"currency": "CZK", "monthlyMinor": 154700, "count": 6}], "url": ""},
    "tasks": {"done": 31, "added": 28, "previousDone": 20, "url": ""},
    "captured": {"notes": 12, "ideas": 1, "links": 0, "feedback": None},
    "site": {"views": 540, "previousViews": 400, "pages": [{"path": "/cv", "label": "CV", "views": 210}], "url": ""},
}
SAVED = {"saved": True, "fileId": "f1", "name": "Monthly report 2026-11.pdf", "url": "https://os.example/app/files/file/f1"}


def fake_bot(fail: bool = False):
    async def send(chat_id, text, **kwargs):
        if fail:
            raise RuntimeError("telegram down")
        return SimpleNamespace(message_id=100)

    return SimpleNamespace(send_message=AsyncMock(side_effect=send))


def monthly_api(**overrides):
    api = SimpleNamespace(
        monthly=AsyncMock(return_value=REPORT),
        monthly_pdf=AsyncMock(return_value=SAVED),
        ack_monthly=AsyncMock(return_value=1),
    )
    for name, value in overrides.items():
        setattr(api, name, value)
    return api


# --- the card ----------------------------------------------------------------------------


def test_monthly_card():
    text = monthly_text(REPORT)
    assert text.splitlines()[0] == "📊 <b>November 2026</b> · monthly report"
    assert f"💸 <b>Spent</b> 12{NBSP}400{NBSP}CZK · ▲ 24 % vs October" in text
    assert f"Income 50{NBSP}000{NBSP}CZK · Net +37{NBSP}600{NBSP}CZK" in text
    # Top three with money spent, escaped; Travel (nothing this month) isn't among them.
    assert f"Groceries 8{NBSP}000{NBSP}CZK · Eating &lt;out&gt; 3{NBSP}000{NBSP}CZK · Transport 1{NBSP}400{NBSP}CZK" in text
    assert f"📈 <b>Biggest changes</b>: Travel −2{NBSP}000{NBSP}CZK · Groceries +2{NBSP}000{NBSP}CZK" in text
    assert f"Also 12.99{NBSP}EUR spent in EUR" in text
    assert f"💳 <b>Subscriptions</b> 1{NBSP}547{NBSP}CZK a month · 6 active" in text
    assert "✅ <b>Tasks</b> 31 done · ▲ 55 % · 28 added" in text
    assert "📥 <b>New</b> · 12 notes · 1 idea" in text
    assert "🌐 <b>Site</b> 540 views · ▲ 35 % · top: CV 210" in text


def test_a_month_in_progress_and_a_quiet_one():
    partial = monthly_text({**REPORT, "partial": True})
    assert partial.splitlines()[0] == "📊 <b>November 2026</b> · so far"

    quiet = monthly_text(
        {**REPORT, "spending": None, "subscriptions": None, "tasks": None, "site": None, "captured": {"notes": 0, "ideas": None}}
    )
    assert quiet.endswith("<i>Nothing recorded this month yet.</i>")


def test_the_journal_line_only_with_data():
    journal = {
        "written": 18,
        "rated": 16,
        "averageMood": 3.8,
        "best": {"day": "2026-11-10", "mood": 5, "text": "Hike"},
        "worst": {"day": "2026-11-03", "mood": 1, "text": "Rain"},
        "url": "",
    }
    text = monthly_text({**REPORT, "journal": journal})
    assert text.endswith("📓 <b>Journal</b> 18 days · mood 3.8 🙂 · best Tue 10 Nov 😄 · hardest Tue 3 Nov 😞")
    lines_only = monthly_text({**REPORT, "journal": {**journal, "rated": 0, "averageMood": None, "best": None, "worst": None}})
    assert lines_only.endswith("📓 <b>Journal</b> 18 days")
    assert "Journal" not in monthly_text({**REPORT, "journal": None})
    # A quiet month with only journal entries isn't "nothing recorded".
    quiet = {**REPORT, "spending": None, "subscriptions": None, "tasks": None, "site": None, "captured": {}, "journal": journal}
    assert "Nothing recorded" not in monthly_text(quiet)


def test_monthly_keyboards():
    scheduled = monthly_keyboard(REPORT, pdf_url=SAVED["url"])
    assert buttons(scheduled) == [("↗ Open in app", REPORT["url"]), ("📄 PDF", SAVED["url"])]
    on_demand = monthly_keyboard(REPORT, refresh=True)
    assert buttons(on_demand) == [("↗ Open in app", REPORT["url"]), ("📄 PDF", REPORT["pdfUrl"]), ("🔄 Refresh", "mo:ref:2026-11")]
    # Local URLs can't be buttons: only Refresh is left.
    local = {**REPORT, "url": "http://localhost:3000/app/review", "pdfUrl": "http://localhost:3000/app/review/pdf"}
    assert buttons(monthly_keyboard(local, refresh=True)) == [("🔄 Refresh", "mo:ref:2026-11")]


# --- schedule ------------------------------------------------------------------------------


def test_report_time_is_the_first_from_ten_in_prague():
    assert report_time(FIRST_MORNING)
    assert not report_time(FIRST_MORNING - timedelta(minutes=10))  # 09:55
    assert not report_time(LAST_DAY)
    assert not report_time(FIRST_MORNING + timedelta(days=1))
    assert previous_month(FIRST_MORNING) == "2026-11"
    assert previous_month(datetime(2027, 1, 1, 9, 5, tzinfo=UTC)) == "2026-12"
    # 23:30 UTC on 31 Dec is already 1 Jan in Prague.
    assert previous_month(datetime(2026, 12, 31, 23, 30, tzinfo=UTC)) == "2026-12"


def test_month_arguments():
    assert parse_month_arg("", FIRST_MORNING) is None
    assert parse_month_arg(" last ", FIRST_MORNING) == "2026-11"
    assert parse_month_arg("2026-10", FIRST_MORNING) == "2026-10"
    assert parse_month_arg("October", FIRST_MORNING) is False
    assert parse_month_arg("2026-13", FIRST_MORNING) is False


async def test_the_report_files_its_pdf_then_goes_out_once_on_the_first():
    api = monthly_api()
    bot = fake_bot()
    memory = MonthlyMemory()
    assert not await monthly_once(bot, api, CHAT, LAST_DAY, memory)
    api.monthly.assert_not_awaited()

    assert await monthly_once(bot, api, CHAT, FIRST_MORNING, memory)
    api.monthly.assert_awaited_once_with("2026-11")
    api.monthly_pdf.assert_awaited_once_with("2026-11")
    call = bot.send_message.call_args
    assert call.args == (CHAT, monthly_text(REPORT))
    assert buttons(call.kwargs["reply_markup"]) == [("↗ Open in app", REPORT["url"]), ("📄 PDF", SAVED["url"])]
    api.ack_monthly.assert_awaited_once_with("2026-11")

    assert not await monthly_once(bot, api, CHAT, FIRST_MORNING + timedelta(minutes=1), memory)
    assert api.monthly.await_count == 1


async def test_the_report_is_not_repeated_after_a_restart():
    api = monthly_api(monthly=AsyncMock(return_value={**REPORT, "delivered": True}))
    bot = fake_bot()
    memory = MonthlyMemory()
    assert not await monthly_once(bot, api, CHAT, FIRST_MORNING, memory)
    bot.send_message.assert_not_awaited()
    api.monthly_pdf.assert_not_awaited()
    assert memory.sent_month == "2026-11"


async def test_a_pdf_that_could_not_be_filed_still_sends_the_card_with_the_app_download():
    api = monthly_api(monthly_pdf=AsyncMock(side_effect=ApiUnreachable("down")))
    bot = fake_bot()
    assert await monthly_once(bot, api, CHAT, FIRST_MORNING, MonthlyMemory())
    assert buttons(bot.send_message.call_args.kwargs["reply_markup"])[1] == ("📄 PDF", REPORT["pdfUrl"])
    api.ack_monthly.assert_awaited_once()


async def test_a_report_that_failed_to_send_is_retried_and_not_acked():
    api = monthly_api()
    memory = MonthlyMemory()
    assert not await monthly_once(fake_bot(fail=True), api, CHAT, FIRST_MORNING, memory)
    api.ack_monthly.assert_not_awaited()
    assert memory.sent_month is None
    assert await monthly_once(fake_bot(), api, CHAT, FIRST_MORNING + timedelta(minutes=1), memory)

    api = monthly_api(monthly=AsyncMock(side_effect=ApiUnreachable("down")))
    assert not await monthly_once(fake_bot(), api, CHAT, FIRST_MORNING, MonthlyMemory())


# --- /month and Refresh ----------------------------------------------------------------------


def month_tg(**overrides) -> Tg:
    return Tg(fake_api(monthly=AsyncMock(return_value=REPORT), **overrides))


async def test_month_command_shows_this_month_with_refresh_and_never_acks():
    tg = month_tg(ack_monthly=AsyncMock(), monthly_pdf=AsyncMock())
    await tg.send("/month")
    tg.api.monthly.assert_awaited_once_with(None)
    sent = tg.session.last("SendMessage")
    assert sent.text == monthly_text(REPORT)
    assert ("🔄 Refresh", "mo:ref:2026-11") in buttons(sent.reply_markup)
    tg.api.ack_monthly.assert_not_awaited()
    tg.api.monthly_pdf.assert_not_awaited()


async def test_month_command_takes_a_month():
    tg = month_tg()
    await tg.send("/month 2026-10")
    tg.api.monthly.assert_awaited_once_with("2026-10")
    await tg.send("/month whenever")
    assert tg.session.last("SendMessage").text.startswith("<b>Which month?</b>")
    assert tg.api.monthly.await_count == 1


async def test_month_errors_are_retryable_and_refresh_edits_in_place():
    tg = month_tg()
    tg.api.monthly = AsyncMock(side_effect=ApiUnreachable("down"))
    await tg.send("/month 2026-10")
    assert buttons(tg.session.last("SendMessage").reply_markup) == [("🔄 Try again", "rt:month:2026-10")]

    tg.api.monthly = AsyncMock(return_value=REPORT)
    await tg.press("rt:month:2026-10", message=bot_message("error"))
    tg.api.monthly.assert_awaited_once_with("2026-10")
    assert tg.session.last("EditMessageText").text == monthly_text(REPORT)

    await tg.press("mo:ref:2026-11", message=bot_message("old"))
    tg.api.monthly.assert_awaited_with("2026-11")
