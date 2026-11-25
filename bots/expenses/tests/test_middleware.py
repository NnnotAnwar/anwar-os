"""Owner gate: the owner, in the private chat with the bot, and nobody else anywhere."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from aiogram.types import Message, Update

from expenses_bot.middleware import NOT_OWNER, OwnerOnlyMiddleware

OWNER = 42


def message(chat: dict, user_id: int) -> Update:
    return Update.model_validate(
        {
            "update_id": 1,
            "message": {
                "message_id": 1,
                "date": 0,
                "chat": chat,
                "from": {"id": user_id, "is_bot": False, "first_name": "X"},
                "text": "/history",
            },
        }
    )


async def run(update: Update):
    handler = AsyncMock(return_value="handled")
    data = {"event_chat": update.message.chat, "event_from_user": update.message.from_user}
    with patch.object(Message, "answer", AsyncMock()) as answer:
        result = await OwnerOnlyMiddleware(OWNER)(handler, update, data)
    return result, handler, answer


async def test_the_owner_in_the_private_chat_is_served():
    result, handler, _ = await run(message({"id": OWNER, "type": "private"}, OWNER))
    assert result == "handled"
    handler.assert_awaited_once()


async def test_the_owner_in_a_group_is_not_served_and_nothing_is_posted_there():
    result, handler, answer = await run(message({"id": -100777, "type": "supergroup", "title": "G"}, OWNER))
    assert result is None
    handler.assert_not_awaited()
    answer.assert_not_awaited()


async def test_a_stranger_in_a_private_chat_gets_one_refusal():
    result, handler, answer = await run(message({"id": 7, "type": "private"}, 7))
    assert result is None
    handler.assert_not_awaited()
    answer.assert_awaited_once_with(NOT_OWNER)
