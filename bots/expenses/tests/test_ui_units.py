"""Pure UI building blocks: categories, periods, rendering, keyboards."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from expenses_bot import categories, keyboards, periods, render
from expenses_bot.api import Category
from expenses_bot.keyboards import EntryCb, PeriodCb, PickCb
from expenses_bot.periods import Period

from .tg import button_data, button_texts

TODAY = date(2026, 11, 22)  # a Sunday


@pytest.fixture(autouse=True)
def fixed_today(monkeypatch):
    monkeypatch.setattr(periods, "today_local", lambda: TODAY)


# --- categories ------------------------------------------------------------------


def _cats(*names: str) -> list[Category]:
    return [Category(id=str(uuid.uuid4()), name=name) for name in names]


def test_category_tokens_are_short_and_resolvable():
    cats = _cats("Food", "Groceries: weekly 🛒", "x" * 60)
    for c in cats:
        tok = categories.token(c.id)
        assert len(tok) == 8 and ":" not in tok
        assert categories.resolve(tok, cats) is c
    assert categories.resolve("deadbeef", cats) is None


def test_picker_order_follows_budget_and_keeps_other():
    ranked = _cats("Health", "Food", "Other")
    assert [c.name for c in categories.picker_order(ranked)] == ["Health", "Food", "Other"]
    many = _cats(*[f"C{i}" for i in range(12)], "Other")
    order = categories.picker_order(many, limit=9)
    assert len(order) == 9 and order[-1].name == "Other" and order[:8] == many[:8]
    no_other = _cats(*[f"C{i}" for i in range(12)])
    assert categories.picker_order(no_other, limit=9) == no_other[:9]
    assert categories.picker_order([]) == []


def test_editing_keeps_the_current_category_on_the_picker():
    shown, rare = _cats("Food", "Fun"), _cats("Rare")[0]
    assert categories.with_current(shown, rare) == [*shown, rare]
    assert categories.with_current(shown, shown[0]) == shown
    assert categories.with_current(shown, None) == shown


def test_category_labels():
    assert categories.label("Food") == "🍔 Food"
    assert categories.label("eating out") == "🍽 eating out"
    assert categories.label("Groceries") == "🛒 Groceries"
    assert categories.label("Car wash") == "🏷 Car wash"
    assert categories.label("Uncategorised") == "❔ Uncategorised"


# --- periods ---------------------------------------------------------------------


def test_period_bounds_follow_prague_dst():
    # 2026-10-25: clocks go back, the day has 25 hours.
    start, end = Period("d", date(2026, 10, 25)).bounds()
    assert start.astimezone(UTC) == datetime(2026, 10, 24, 22, 0, tzinfo=UTC)
    assert end.astimezone(UTC) - start.astimezone(UTC) == timedelta(hours=25)
    month_start, _ = Period.containing("m", date(2026, 11, 16)).bounds()
    assert month_start.astimezone(UTC) == datetime(2026, 10, 31, 23, 0, tzinfo=UTC)


def test_period_navigation_and_encoding():
    week = Period.containing("w", date(2026, 11, 19))
    assert week.start == date(2026, 11, 16) and week.end == date(2026, 11, 23)
    jan = Period.containing("m", date(2026, 1, 31))
    assert jan.prev.start == date(2025, 12, 1) and jan.next.start == date(2026, 2, 1)
    for p in (week, jan, Period("d", TODAY)):
        assert Period.decode(p.encode()) == p
    assert Period.decode("m20261131") is None
    assert Period.decode("x20261101") is None
    assert Period.decode("w20261119") == week  # snapped to Monday


def test_period_titles():
    assert Period("d", TODAY).title() == "Today · Sun 22 Nov"
    assert Period("d", TODAY - timedelta(days=1)).title() == "Yesterday · Sat 21 Nov"
    assert Period("d", date(2026, 11, 3)).title() == "Tuesday 3 Nov"
    assert Period.containing("w", TODAY).title() == "This week · 16–22 Nov"
    assert Period.containing("w", date(2026, 11, 1)).title() == "Week 44 · 26 Oct – 1 Nov"
    assert Period.containing("w", date(2025, 12, 31)).title() == "Week 1 · 29 Dec – 4 Jan 2026"
    assert Period.containing("m", TODAY).title() == "November 2026"
    assert Period.containing("m", TODAY).prev.short() == "Oct"
    assert Period.containing("m", date(2025, 3, 1)).short() == "Mar 2025"


def test_human_dates():
    assert periods.human_day(TODAY, TODAY) == "Today"
    assert periods.human_day(date(2026, 11, 17), TODAY) == "Tue 17 Nov"
    assert periods.human_day(date(2025, 2, 3), TODAY) == "3 Feb 2025"
    # 08:15 UTC is 09:15 in Prague (CET).
    assert periods.human_datetime(datetime(2026, 11, 22, 8, 15, tzinfo=UTC), TODAY) == "Today, 09:15"


# --- rendering -------------------------------------------------------------------


def _cat(category, total, n=1, currency="CZK"):
    return {"category": category, "currency": currency, "total_minor": total, "n": n}


def test_bar():
    assert render.bar(0.5) == "████░░░░"
    assert render.bar(0.01) == "█░░░░░░░"  # visible, however small
    assert render.bar(0) == "░" * 8


def test_comparison_lines():
    assert render.comparison(12000, 10000, "October", "CZK") == "▲ 20% vs October (100\u00a0CZK)"
    assert render.comparison(9000, 10000, "last week", "CZK").startswith("▼ 10% vs last week")
    assert render.comparison(10000, 10000, "yesterday", "CZK").startswith("＝ same as yesterday")
    assert render.comparison(500, 0, "yesterday", "CZK") == "Nothing spent yesterday"
    assert render.comparison(0, 0, "yesterday", "CZK") == ""


def test_month_overview_card():
    rows = [_cat("Food", 520000, 20), _cat("Transport", 210000, 8), _cat("Entertainment", 99000, 3)]
    text = render.overview(
        render.Overview(
            period=Period.containing("m", TODAY),
            category_rows=rows,
            previous_totals={"CZK": 700000},
            previous_partial=True,
            elapsed_days=22,
        )
    )
    assert text.startswith("📊 <b>November 2026</b>")
    assert "<b>8\u00a0290\u00a0CZK</b> · 31 expenses" in text
    assert "▲ 18% vs October at this point (7\u00a0000\u00a0CZK)" in text
    assert "≈ 377\u00a0CZK a day" in text
    assert "Food       █████░░░ 5 200  63%" in text
    assert "Entertain… █░░░░░░░   990  12%" in text


def test_overview_groups_tail_and_other_currencies():
    rows = [_cat(f"Cat{i}", 1000 * (10 - i)) for i in range(8)] + [_cat("Travel", 5000, currency="EUR")]
    text = render.overview(
        render.Overview(period=Period.containing("w", TODAY), category_rows=rows, previous_totals={})
    )
    assert "+ 50\u00a0EUR" in text
    assert "+2 more" in text


def test_day_overview_lists_entries_aligned_and_escaped():
    entries = [
        {"category": "Food", "currency": "CZK", "amount_minor": 25000, "note": "<b>coffee</b>", "timed": True,
         "when": datetime(2026, 11, 22, 8, 15, tzinfo=UTC)},
        {"category": "Transport", "currency": "CZK", "amount_minor": 112050, "note": None, "timed": True,
         "when": datetime(2026, 11, 22, 11, 40, tzinfo=UTC)},
        {"category": "Gifts", "currency": "CZK", "amount_minor": 100, "note": None, "timed": False,
         "when": datetime(2026, 11, 21, 23, 0, tzinfo=UTC)},
    ]
    text = render.overview(
        render.Overview(
            period=Period("d", TODAY),
            category_rows=[_cat("Food", 25000), _cat("Transport", 112050)],
            previous_totals={"CZK": 50000},
            previous_partial=True,
            entries=entries,
        )
    )
    assert "vs yesterday by this time" in text
    assert "09:15   250     Food · &lt;b&gt;coffee&lt;/b&gt;" in text
    assert "12:40 1 120.50  Transport" in text
    assert "--:--     1     Gifts" in text
    assert "a day" not in text


def test_empty_overviews_say_what_to_do():
    current = render.overview(render.Overview(period=Period("d", TODAY), category_rows=[], previous_totals={}))
    assert "Nothing logged yet" in current and "<code>250 coffee</code>" in current
    past = render.overview(
        render.Overview(period=Period("d", date(2026, 1, 1)), category_rows=[], previous_totals={"CZK": 100})
    )
    assert "No expenses in this period." in past


def test_history_page_groups_by_day_and_escapes():
    rows = [
        {"id": "b", "amount_minor": 25000, "currency": "CZK", "category": "Food", "note": "a & b", "timed": True,
         "occurred_on": TODAY, "when": datetime(2026, 11, 22, 8, 15, tzinfo=UTC)},
        {"id": "a", "amount_minor": 1550, "currency": "CZK", "category": "<x>", "note": None, "timed": True,
         "occurred_on": date(2026, 11, 20), "when": datetime(2026, 11, 20, 18, 0, tzinfo=UTC)},
        {"id": "c", "amount_minor": 900, "currency": "CZK", "category": "Gifts", "note": None, "timed": False,
         "occurred_on": date(2026, 11, 20), "when": datetime(2026, 11, 19, 23, 0, tzinfo=UTC)},
    ]
    text = render.history_page(rows, 0, 3, 19, 0, TODAY)
    assert "· 1–3 of 19" in text
    assert "<b>Today</b>\n1. <b>250\u00a0CZK</b> 🍔 Food — a &amp; b <i>09:15</i>" in text
    assert "<b>Fri 20 Nov</b>\n2. <b>15.50\u00a0CZK</b> 🏷 &lt;x&gt; <i>19:00</i>\n3. <b>9\u00a0CZK</b> 🎁 Gifts\n" in text
    assert "Nothing here yet" in render.history_page([], 0, 1, 0, 0, TODAY)


def test_welcome_escapes_name():
    assert "Hi, &lt;Anwar&gt;!" in render.welcome("<Anwar>")


# --- keyboards -------------------------------------------------------------------


def test_callback_data_fits_telegram_limit():
    worst = [
        PickCb(cat=categories.token(str(uuid.uuid4())), amount=99999999999, note=True).pack(),
        EntryCb(action="cs", id=uuid.uuid4().hex, origin="99999", cat=categories.token(str(uuid.uuid4()))).pack(),
        PeriodCb(p=Period("w", TODAY).encode()).pack(),
    ]
    assert all(len(d.encode()) <= 64 for d in worst)


def test_overview_nav_hides_future_and_offers_way_back():
    current = keyboards.overview_nav(Period.containing("m", TODAY))
    assert button_texts(current) == [["◀ Oct"], ["Day", "Week", "· Month ·"], ["⬇️ Export CSV"]]
    past = keyboards.overview_nav(Period.containing("m", date(2026, 9, 1)))
    assert button_texts(past)[0] == ["◀ Aug", "↺ Nov", "Oct ▶"]
    day = keyboards.overview_nav(Period("d", TODAY))
    assert all("⬇️ Export CSV" not in row for row in button_texts(day))


def test_expense_ids_round_trip_through_callback_data():
    expense_id = str(uuid.uuid4())
    assert keyboards.full_id(keyboards.short_id(expense_id)) == expense_id
    assert keyboards.full_id("17") is None
    assert keyboards.full_id("z" * 32) is None


ID = "0b9f7c5e-2a4d-4e8f-9c1a-3d5e7f9a1b2c"


def test_expense_action_keyboards():
    fresh = keyboards.expense_actions(ID)
    assert button_texts(fresh) == [["↩️ Undo", "✏️ Amount"], ["🏷 Category", "📝 Note"]]
    from_list = keyboards.expense_actions(ID, "2")
    assert button_texts(from_list)[-1] == ["‹ Back to list"]
    assert "🗑 Delete" in button_texts(from_list)[1]


def test_history_keyboard_numbers_and_pages():
    ids = [str(uuid.uuid4()) for _ in range(5)]
    kb = keyboards.history(ids, page=1, pages=3)
    assert button_texts(kb) == [["1", "2", "3", "4"], ["5"], ["◀ Newer", "2/3", "Older ▶"]]
    assert button_data(kb)[0] == f"ex:v:{uuid.UUID(ids[0]).hex}:1:"


def test_main_menu_is_persistent():
    menu = keyboards.main_menu()
    assert menu.is_persistent and menu.resize_keyboard
    assert [b.text for row in menu.keyboard for b in row] == list(keyboards.MENU_BUTTONS)
