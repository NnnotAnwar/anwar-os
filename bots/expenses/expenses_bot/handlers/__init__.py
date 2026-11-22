from .commands import router as commands_router
from .entries import router as entries_router
from .expense import router as expense_router
from .fallback import on_error
from .fallback import router as fallback_router

# Order matters: commands and menu buttons first (they work in any state), then text
# input for an edit in progress, then quick entry, then the catch-alls.
routers = [commands_router, entries_router, expense_router, fallback_router]

__all__ = ["on_error", "routers"]
