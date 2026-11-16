from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

CATEGORIES = ["Food", "Transport", "Utilities", "Entertainment", "Health", "Other"]
CATEGORY_PREFIX = "category_"


def get_categories_keyboard() -> InlineKeyboardMarkup:
    buttons = [
        InlineKeyboardButton(text=category, callback_data=f"{CATEGORY_PREFIX}{category}")
        for category in CATEGORIES
    ]
    # Rows of 2 buttons
    rows = [buttons[i : i + 2] for i in range(0, len(buttons), 2)]
    return InlineKeyboardMarkup(inline_keyboard=rows)
