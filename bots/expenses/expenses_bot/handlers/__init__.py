from .commands import router as commands_router
from .expense import router as expense_router

routers = [commands_router, expense_router]
