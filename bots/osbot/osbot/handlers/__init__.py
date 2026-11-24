from aiogram import Router

from . import alerts, capture, fallback, menu, monthly, today, weekly
from .fallback import on_error


def make_routers() -> list[Router]:
    """Fresh routers for one Dispatcher (a router can only be attached once).

    Order matters: capture catches every message the others don't, and the
    fallback catches every button nobody else handles.
    """
    return [menu.make_router(), today.make_router(), weekly.make_router(), monthly.make_router(), alerts.make_router(), capture.make_router(), fallback.make_router()]


__all__ = ["make_routers", "on_error"]
