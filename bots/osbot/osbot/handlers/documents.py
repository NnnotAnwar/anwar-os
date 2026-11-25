"""The 💤 Remind tomorrow button on document expiry cards (documents.py).

↗ Open and ✓ Renewed are URL buttons: Renewed opens the document in the app
with the new expiry date ready, so nothing to handle here.
"""

from __future__ import annotations

import logging

from aiogram import Router, types

from .. import texts
from ..api import OsbotApi
from ..documents import DocumentCb, snoozed_note
from ..errors import describe
from ..keyboards import only_links
from ..tg import accessible, edit

log = logging.getLogger(__name__)


async def on_document(callback: types.CallbackQuery, callback_data: DocumentCb, api: OsbotApi) -> None:
    if callback_data.action != "snz" or not callback_data.id:
        await callback.answer(texts.STALE)
        return
    card = accessible(callback)
    try:
        data = await api.snooze_document(callback_data.id)
    except Exception as error:
        await callback.answer(describe(error, action="document snooze").toast(), show_alert=True)
        return
    if card is not None:
        await edit(card, f"{card.html_text}\n\n{snoozed_note(data)}", only_links(card.reply_markup))
    await callback.answer(f"💤 Tomorrow at {data.get('time') or '10:00'}")


def make_router() -> Router:
    router = Router(name="documents")
    router.callback_query.register(on_document, DocumentCb.filter())
    return router
