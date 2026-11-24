"""Message texts (Telegram HTML). Pure functions: data in, string out.

Every value that came from a user (categories, notes) goes through `escape`.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from html import escape
from typing import Any

from . import categories
from .config import DEFAULT_CURRENCY
from .money import NBSP, format_amount, format_number
from .periods import Period, human_datetime, human_day, to_local

EXAMPLE = "<code>250 coffee</code>"

PERIOD_ICON = {"d": "📅", "w": "🗓", "m": "📊"}

BAR_WIDTH = 8
NAME_WIDTH = 10
TOP_CATEGORIES = 6
DAY_ENTRIES = 12

Row = Mapping[str, Any]


def plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


# --- onboarding ------------------------------------------------------------------


def welcome(first_name: str | None) -> str:
    hello = f"Hi, {escape(first_name)}!" if first_name else "Hi!"
    return (
        f"👋 <b>{hello}</b> I keep track of what you spend.\n\n"
        f"Just send an amount, optionally with a note:\n"
        f"{EXAMPLE} · <code>89</code> · <code>1200 food groceries</code>\n\n"
        "I'll ask for the category (or remember it), and you can undo or fix it right away.\n"
        "Use the buttons below for today, this week, this month and your recent entries."
    )


def help_text(currency: str = DEFAULT_CURRENCY) -> str:
    return (
        "<b>How to use the bot</b>\n\n"
        "<b>Log an expense</b> — send a message:\n"
        f"• {EXAMPLE} → amount + note, then pick a category\n"
        "• <code>250 food</code> → saved straight to Food\n"
        "• <code>250 food lunch</code> → Food, with the note “lunch”\n"
        "• <code>15,50</code> or <code>15.50</code> → decimals work too\n"
        "Notes you have used before are filed under the same category automatically.\n"
        "📷 Or send a photo of a receipt: I read the total, shop and date and ask before saving.\n\n"
        "<b>See your spending</b>\n"
        "/today · /week · /month — totals, top categories, comparison with the previous period; "
        "use ◀ ▶ to move between periods\n"
        "/history — recent entries; tap one to edit or delete it\n"
        "/subscriptions — what your subscriptions cost a month and a year, and when each charges next\n"
        "/export — this month as a CSV file\n\n"
        f"Everything lands in Budget on anwar.os ({currency}, your default account); "
        "categories are Budget's, dates are Prague time. Edits made there show up here too."
    )


def unknown_text() -> str:
    return (
        "🤔 I didn't catch an amount there.\n"
        f"Send something like {EXAMPLE} or <code>89</code>, or use the menu below."
    )


def ask_amount() -> str:
    return f"💸 How much did you spend? Send an amount, optionally with a note, e.g. {EXAMPLE}."


def invalid_amount() -> str:
    return "That doesn't look like an amount. Send a positive number like <code>250</code> or <code>15.50</code>."


# --- expense cards ---------------------------------------------------------------


def amount_line(row: Row) -> str:
    return (
        f"<b>{format_amount(row['amount_minor'], row['currency'])}</b> · "
        f"{escape(categories.label(row['category']))}"
    )


def picker(amount_minor: int, note: str | None, currency: str = DEFAULT_CURRENCY, day: Any = None, today: Any = None) -> str:
    head = f"💸 <b>{format_amount(amount_minor, currency)}</b>"
    if note:
        head += f" · {escape(note)}"
    if day is not None and human_day(day, today) != "Today":
        head += f" · {human_day(day, today)}"
    return f"{head}\nPick a category:"


@dataclass(frozen=True)
class CardContext:
    title: str = "✅ <b>Saved</b>"
    footer: str | None = None
    prompt: str | None = None


def expense_card(row: Row, ctx: CardContext | None = None, today: Any = None) -> str:
    ctx = ctx or CardContext()
    lines = [ctx.title, "", amount_line(row)]
    if row.get("note"):
        lines.append(f"📝 {escape(row['note'])}")
    lines.append(f"🕘 {when_text(row, today)}")
    if ctx.footer:
        lines += ["", ctx.footer]
    if ctx.prompt:
        lines += ["", ctx.prompt]
    return "\n".join(lines)


def when_text(row: Row, today: Any = None) -> str:
    """"Today, 09:15" when Budget knows the time (it was recorded that day), else just the day."""
    if row.get("timed", True):
        return human_datetime(row.get("when") or row["created_at"], today)
    return human_day(row["occurred_on"], today)


def running_totals(
    day_total: Mapping[str, int], month_total: Mapping[str, int], period_month: Period, currency: str = DEFAULT_CURRENCY
) -> str:
    day = _currency_list(day_total) or format_amount(0, currency)
    month = _currency_list(month_total) or format_amount(0, currency)
    return f"<i>Today {day} · {period_month.start:%B} {month}</i>"


def undone(row: Row) -> str:
    return (
        f"↩️ <s>{format_amount(row['amount_minor'], row['currency'])} · {escape(row['category'])}</s>\n"
        "Removed. Send a new amount whenever you're ready."
    )


def deleted(row: Row) -> str:
    return f"🗑 Deleted {format_amount(row['amount_minor'], row['currency'])} · {escape(row['category'])}."


def confirm_delete(row: Row, today: Any = None) -> str:
    return expense_card(
        row,
        CardContext(title="🗑 <b>Delete this expense?</b>", prompt="This can't be undone."),
        today,
    )


PROMPT_AMOUNT = "✏️ <b>Send the new amount</b>, e.g. <code>320</code> or <code>15.50</code>."
PROMPT_NOTE = "📝 <b>Send the note</b> (up to 200 characters). Send <code>-</code> to remove it."
PROMPT_CATEGORY = "🏷 <b>Pick the new category:</b>"


# --- overviews -------------------------------------------------------------------


@dataclass
class Overview:
    period: Period
    category_rows: Sequence[Row]  # category, currency, total_minor, n
    previous_totals: Mapping[str, int]  # per currency, for the comparison window
    previous_partial: bool = False  # True: previous period cut at the same point in time
    entries: Sequence[Row] = field(default_factory=list)  # for day overviews
    elapsed_days: int | None = None  # for the daily average of the current period


def _currency_list(totals: Mapping[str, int]) -> str:
    def order(currency: str) -> tuple[int, str]:
        return (0 if currency == DEFAULT_CURRENCY else 1, currency)

    return ", ".join(format_amount(totals[c], c) for c in sorted(totals, key=order) if totals[c])


def primary_currency(totals: Mapping[str, int]) -> str:
    if not totals or DEFAULT_CURRENCY in totals:
        return DEFAULT_CURRENCY
    return max(totals, key=lambda c: totals[c])


def bar(share: float, width: int = BAR_WIDTH) -> str:
    filled = round(share * width)
    if share > 0 and filled == 0:
        filled = 1
    return "█" * filled + "░" * (width - filled)


def _fit(text: str, width: int) -> str:
    return text if len(text) <= width else text[: width - 1] + "…"


def comparison(current: int, previous: int, label: str, currency: str) -> str:
    prev_text = format_amount(previous, currency, whole_only=True)
    if previous <= 0:
        return f"Nothing spent {label}" if current else ""
    change = round((current - previous) / previous * 100)
    if change == 0:
        return f"＝ same as {label} ({prev_text})"
    arrow = "▲" if change > 0 else "▼"
    return f"{arrow} {abs(change)}% vs {label} ({prev_text})"


def category_table(rows: Sequence[tuple[str, int]], total: int) -> str:
    """Monospace block: name, bar, amount (whole units), share."""
    shown = list(rows[:TOP_CATEGORIES])
    rest = rows[TOP_CATEGORIES:]
    if rest:
        shown.append((f"+{len(rest)} more", sum(amount for _, amount in rest)))
    name_width = min(NAME_WIDTH, max(len(name) for name, _ in shown))
    amounts = [format_number(amount, whole_only=True).replace(NBSP, " ") for _, amount in shown]
    amount_width = max(len(a) for a in amounts)
    lines = []
    for (name, amount), amount_text in zip(shown, amounts, strict=True):
        share = amount / total if total else 0
        lines.append(
            f"{_fit(name, name_width):<{name_width}} {bar(share)} "
            f"{amount_text:>{amount_width}} {round(share * 100):>3}%"
        )
    return "<pre>" + escape("\n".join(lines)) + "</pre>"


def aligned_amounts(values: Sequence[int]) -> list[str]:
    """Amounts as equal-width strings aligned on the decimal point: "  250   ", "1 120.50"."""
    parts = [format_number(v).replace(NBSP, " ").partition(".") for v in values]
    whole_width = max(len(whole) for whole, _, _ in parts)
    any_cents = any(cents for _, _, cents in parts)
    out = []
    for whole, _, cents in parts:
        tail = f".{cents}" if cents else ("   " if any_cents else "")
        out.append(f"{whole:>{whole_width}}{tail}")
    return out


def day_entries_table(entries: Sequence[Row], currency: str) -> str:
    shown = [e for e in entries if e["currency"] == currency][:DAY_ENTRIES]
    amounts = aligned_amounts([e["amount_minor"] for e in shown])
    width = max(len(a) for a in amounts)
    lines = []
    for entry, amount_text in zip(shown, amounts, strict=True):
        what = entry["category"] + (f" · {entry['note']}" if entry.get("note") else "")
        clock = f"{to_local(entry['when']):%H:%M}" if entry.get("timed", True) else "--:--"
        lines.append(f"{clock} {amount_text:>{width}}  {_fit(what, 22)}")
    more = len([e for e in entries if e["currency"] == currency]) - len(shown)
    if more > 0:
        lines.append(f"… and {more} more")
    return "<pre>" + escape("\n".join(lines)) + "</pre>"


def overview(ov: Overview) -> str:
    period = ov.period
    head = f"{PERIOD_ICON[period.kind]} <b>{escape(period.title())}</b>"
    totals: dict[str, int] = {}
    count = 0
    for row in ov.category_rows:
        totals[row["currency"]] = totals.get(row["currency"], 0) + row["total_minor"]
        count += row["n"]

    if not count:
        if period.is_current():
            empty = f"Nothing logged yet.\nSend an amount like {EXAMPLE} to add one."
        else:
            empty = "No expenses in this period."
        lines = [head, "", empty]
        if ov.previous_totals:
            cur = primary_currency(ov.previous_totals)
            line = comparison(0, ov.previous_totals.get(cur, 0), _vs_label(ov), cur)
            if line:
                lines += ["", line]
        return "\n".join(lines)

    currency = primary_currency(totals)
    total = totals[currency]
    lines = [head, "", f"<b>{format_amount(total, currency)}</b> · {plural(count, 'expense')}"]
    others = {c: v for c, v in totals.items() if c != currency}
    if others:
        lines.append(f"+ {_currency_list(others)}")
    line = comparison(total, ov.previous_totals.get(currency, 0), _vs_label(ov), currency)
    if line:
        lines.append(line)
    if period.kind != "d":
        days = ov.elapsed_days or period.days
        lines.append(f"≈ {format_amount(round(total / days), currency, whole_only=True)} a day")

    lines.append("")
    if period.kind == "d" and ov.entries:
        lines.append(day_entries_table(ov.entries, currency))
    else:
        rows = [(r["category"], r["total_minor"]) for r in ov.category_rows if r["currency"] == currency]
        lines.append(category_table(rows, total))
    return "\n".join(lines)


def _vs_label(ov: Overview) -> str:
    label = ov.period.comparison_label()
    if ov.previous_partial:
        return f"{label} by this time" if ov.period.kind == "d" else f"{label} at this point"
    return label


# --- history ---------------------------------------------------------------------


def history_page(rows: Sequence[Row], page: int, pages: int, total: int, offset: int, today: Any = None) -> str:
    if not rows:
        return f"🧾 <b>Recent expenses</b>\n\nNothing here yet. Send an amount like {EXAMPLE} to log your first one."
    first, last = offset + 1, offset + len(rows)
    lines = [f"🧾 <b>Recent expenses</b> · {first}–{last} of {total}"]
    current_day = None
    for number, row in enumerate(rows, start=1):
        day = row["occurred_on"]
        if day != current_day:
            current_day = day
            lines += ["", f"<b>{human_day(current_day, today)}</b>"]
        note = f" — {escape(row['note'])}" if row.get("note") else ""
        clock = f" <i>{to_local(row['when']):%H:%M}</i>" if row.get("timed", True) else ""
        lines.append(
            f"{number}. <b>{format_amount(row['amount_minor'], row['currency'])}</b> "
            f"{escape(categories.label(row['category']))}{note}{clock}"
        )
    lines += ["", "Tap a number to edit or delete."]
    return "\n".join(lines)


def export_caption(period: Period, count: int) -> str:
    return f"📄 {escape(period.title())} · {plural(count, 'expense')}"


def stale() -> str:
    return "This button has expired."
