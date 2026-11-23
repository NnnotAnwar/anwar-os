"""/today: the agenda, paged task list and one-task cards with Done / Tomorrow / Undo.

Everything happens in one message, edited in place. Buttons carry the task id
and the page to go back to; the list is fetched fresh on every view, so a task
done in the app meanwhile simply drops out.
"""

from __future__ import annotations

import logging
from typing import Any

from aiogram import F, Router, types
from aiogram.filters import Command

from .. import texts
from ..api import OsbotApi
from ..errors import describe
from ..keyboards import (
    MenuCb,
    RetryCb,
    TaskCb,
    TodayCb,
    retry_keyboard,
    task_done_keyboard,
    task_keyboard,
    task_moved_keyboard,
    today_keyboard,
)
from ..tg import accessible, edit, typing

log = logging.getLogger(__name__)

NOT_DUE = "That task isn't due today any more."


def today_view(data: dict[str, Any], page: int, app_url: str) -> tuple[str, Any]:
    page = min(max(page, 0), texts.pages(len(data.get("tasks") or [])) - 1)
    return texts.today_text(data, page=page), today_keyboard(data, page, app_url)


async def cmd_today(message: types.Message, api: OsbotApi, app_url: str) -> None:
    await typing(message)
    try:
        data = await api.today()
    except Exception as error:
        problem = describe(error, action="today")
        retry = retry_keyboard(RetryCb(what="today")) if problem.retry else None
        await message.answer(problem.html(), reply_markup=retry)
        return
    text, markup = today_view(data, 0, app_url)
    await message.answer(text, reply_markup=markup)


async def _show_today(callback: types.CallbackQuery, api: OsbotApi, app_url: str, page: int, toast: str | None = None) -> None:
    message = accessible(callback)
    if message is None:
        await callback.answer(texts.STALE)
        return
    try:
        data = await api.today()
    except Exception as error:
        await callback.answer(describe(error, action="today").toast(), show_alert=True)
        return
    text, markup = today_view(data, page, app_url)
    await edit(message, text, markup)
    await callback.answer(toast)


async def on_today(callback: types.CallbackQuery, callback_data: TodayCb, api: OsbotApi, app_url: str) -> None:
    await _show_today(callback, api, app_url, callback_data.page)


async def on_today_retry(callback: types.CallbackQuery, api: OsbotApi, app_url: str) -> None:
    await _show_today(callback, api, app_url, 0)


TOASTS = {"done": "✅ Done", "undone": "↩ Back on the list", "tmr": "⏭ Moved to tomorrow", "due": "↩ Moved back"}


async def on_task(callback: types.CallbackQuery, callback_data: TaskCb, api: OsbotApi, app_url: str) -> None:
    message = accessible(callback)
    if message is None:
        await callback.answer(texts.STALE)
        return
    cb = callback_data

    if cb.action == "open":
        try:
            data = await api.today()
        except Exception as error:
            await callback.answer(describe(error, action="today").toast(), show_alert=True)
            return
        task = next((t for t in data.get("tasks") or [] if t.get("id") == cb.id), None)
        if task is None:
            text, markup = today_view(data, cb.page, app_url)
            await edit(message, text, markup)
            await callback.answer(NOT_DUE)
            return
        await edit(message, texts.task_card(task), task_keyboard(task, cb.page))
        await callback.answer()
        return

    actions = {"done": ("complete", None), "undone": ("reopen", None), "tmr": ("postpone", None), "due": ("schedule", cb.due)}
    if cb.action not in actions:
        await callback.answer(texts.STALE)
        return
    action, due = actions[cb.action]
    try:
        task = await api.task_action(cb.id, action, None if due in (None, "-") else due)
    except Exception as error:
        problem = describe(error, action=f"task {action}")
        if problem.kind == "gone":
            await _show_today(callback, api, app_url, cb.page, toast=problem.toast())
        else:
            await callback.answer(problem.toast(), show_alert=True)
        return

    if cb.action == "done":
        await edit(message, texts.task_done_card(task), task_done_keyboard(task, cb.page))
    elif cb.action == "tmr":
        await edit(message, texts.task_moved_card(task), task_moved_keyboard(task, cb.page))
    else:
        await edit(message, texts.task_card(task), task_keyboard(task, cb.page))
    await callback.answer(TOASTS[cb.action])


def make_router() -> Router:
    router = Router(name="today")
    router.message.register(cmd_today, Command("today"))
    router.message.register(cmd_today, F.text == texts.MENU_TODAY)
    router.callback_query.register(on_today, TodayCb.filter())
    router.callback_query.register(on_today_retry, RetryCb.filter(F.what == "today"))
    router.callback_query.register(on_today_retry, MenuCb.filter(F.to == "today"))
    router.callback_query.register(on_task, TaskCb.filter())
    return router
