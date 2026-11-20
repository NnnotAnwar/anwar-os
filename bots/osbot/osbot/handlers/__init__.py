from .capture import router as capture_router
from .commands import router as commands_router

# Commands first: the capture router catches every other message.
routers = [commands_router, capture_router]
