"""OsbotApi against a fake web app (a local aiohttp server that checks signatures)."""

from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from aiohttp import web
from aiohttp.test_utils import TestServer

from osbot import signing
from osbot.api import ApiError, ApiUnreachable, OsbotApi

SECRET = "fake-api-secret-0123456789abcdef0123"


@pytest.fixture
async def fake_web():
    calls: list[dict] = []
    replies: dict[str, tuple[int, object]] = {}

    async def handle(request: web.Request) -> web.Response:
        body = await request.text()
        # verify() wants lowercase header names.
        lowered = {k.lower(): v for k, v in request.headers.items()}
        ok = signing.verify(SECRET, lowered, request.method, request.raw_path, body)
        calls.append({"method": request.method, "path": request.raw_path, "body": json.loads(body) if body else None, "signed": ok})
        if not ok:
            return web.json_response({"error": "unauthorized"}, status=401)
        status, payload = replies.get(request.path, (200, {"ok": True}))
        return web.json_response(payload, status=status)

    app = web.Application()
    app.router.add_route("*", "/{tail:.*}", handle)
    server = TestServer(app)
    await server.start_server()
    try:
        yield server, calls, replies
    finally:
        await server.close()


async def test_signs_requests_the_way_the_web_app_checks_them(fake_web):
    server, calls, replies = fake_web
    replies["/api/internal/osbot/reminders/due"] = (200, {"now": "x", "reminders": [{"keys": ["k"]}]})
    async with OsbotApi(str(server.make_url("")), SECRET) as api:
        reminders = await api.reminders_due(datetime(2026, 11, 16, 12, 30, tzinfo=UTC))
    assert reminders == [{"keys": ["k"]}]
    assert calls == [
        {"method": "GET", "path": "/api/internal/osbot/reminders/due?until=1794832200000", "body": None, "signed": True}
    ]


async def test_sends_json_bodies_exactly_as_signed(fake_web):
    server, calls, replies = fake_web
    replies["/api/internal/osbot/capture"] = (200, {"kind": "note", "id": "1", "title": "Milk ✓", "url": "u", "duplicate": False})
    async with OsbotApi(str(server.make_url("")), SECRET) as api:
        result = await api.capture("note", "Milk ✓\nand bread")
        await api.capture(None, "default target", None)
        await api.capture("link", "see https://a.example", "https://a.example")
    assert result["title"] == "Milk ✓"
    assert all(c["signed"] for c in calls)
    assert [c["body"] for c in calls] == [
        {"kind": "note", "text": "Milk ✓\nand bread"},
        {"text": "default target"},
        {"kind": "link", "text": "see https://a.example", "url": "https://a.example"},
    ]


async def test_every_endpoint(fake_web):
    server, calls, replies = fake_web
    replies.update(
        {
            "/api/internal/osbot/reminders/ack": (200, {"acked": 2}),
            "/api/internal/osbot/feedback/new": (200, {"items": [{"id": "f1"}]}),
            "/api/internal/osbot/feedback/ack": (200, {"acked": 1}),
            "/api/internal/osbot/today": (200, {"date": "Monday 16 Nov", "events": []}),
            "/api/internal/osbot/capture/targets": (200, {"default": "note", "targets": []}),
        }
    )
    async with OsbotApi(str(server.make_url("")) + "/", SECRET) as api:
        assert await api.ack_reminders(["a", "b"]) == 2
        assert await api.new_feedback() == [{"id": "f1"}]
        assert await api.ack_feedback(["f1"]) == 1
        assert (await api.today())["date"] == "Monday 16 Nov"
        assert (await api.capture_targets())["default"] == "note"
        await api.heartbeat("v1", datetime(2026, 11, 16, tzinfo=UTC))
    assert all(c["signed"] for c in calls)
    assert calls[-1]["body"] == {"version": "v1", "startedAt": "2026-11-16T00:00:00+00:00"}


async def test_button_endpoints(fake_web):
    server, calls, replies = fake_web
    replies["/api/internal/osbot/tasks/action"] = (200, {"id": "t1", "done": True})
    replies["/api/internal/osbot/feedback/status"] = (200, {"id": "f1", "status": "read", "previous": "new"})
    async with OsbotApi(str(server.make_url("")), SECRET) as api:
        await api.undo_capture("note", "n1")
        assert (await api.task_action("t1", "complete"))["done"] is True
        await api.task_action("t1", "schedule", "2026-11-14")
        await api.task_action("t1", "schedule", None)
        assert (await api.feedback_status("f1", "read"))["previous"] == "new"
    assert all(c["signed"] for c in calls)
    assert [(c["path"], c["body"]) for c in calls] == [
        ("/api/internal/osbot/capture/undo", {"kind": "note", "id": "n1"}),
        ("/api/internal/osbot/tasks/action", {"id": "t1", "action": "complete"}),
        ("/api/internal/osbot/tasks/action", {"id": "t1", "action": "schedule", "dueDate": "2026-11-14"}),
        ("/api/internal/osbot/tasks/action", {"id": "t1", "action": "schedule", "dueDate": None}),
        ("/api/internal/osbot/feedback/status", {"id": "f1", "status": "read"}),
    ]


async def test_contact_endpoints(fake_web):
    server, calls, replies = fake_web
    replies.update(
        {
            "/api/internal/osbot/contact/new": (200, {"items": [{"id": "c1"}]}),
            "/api/internal/osbot/contact/ack": (200, {"acked": 1}),
            "/api/internal/osbot/contact/status": (200, {"id": "c1", "status": "replied", "previous": "new"}),
        }
    )
    async with OsbotApi(str(server.make_url("")), SECRET) as api:
        assert await api.new_contact() == [{"id": "c1"}]
        assert await api.ack_contact(["c1"]) == 1
        assert (await api.contact_status("c1", "replied"))["previous"] == "new"
    assert all(c["signed"] for c in calls)
    assert [(c["path"], c["body"]) for c in calls][1:] == [
        ("/api/internal/osbot/contact/ack", {"ids": ["c1"]}),
        ("/api/internal/osbot/contact/status", {"id": "c1", "status": "replied"}),
    ]


async def test_no_answer_at_all_is_unreachable():
    # Nothing listens on port 9 (discard) locally: connection refused.
    async with OsbotApi("http://127.0.0.1:9", SECRET) as api:
        with pytest.raises(ApiUnreachable):
            await api.today()


async def test_errors_carry_the_api_message(fake_web):
    server, _, replies = fake_web
    replies["/api/internal/osbot/capture"] = (422, {"error": "not_captured", "message": "No link found."})
    async with OsbotApi(str(server.make_url("")), SECRET) as api:
        with pytest.raises(ApiError) as caught:
            await api.capture("link", "nothing")
    assert (caught.value.status, caught.value.code, caught.value.message) == (422, "not_captured", "No link found.")


async def test_a_wrong_secret_is_refused(fake_web):
    server, _, _ = fake_web
    async with OsbotApi(str(server.make_url("")), SECRET + "-wrong") as api:
        with pytest.raises(ApiError) as caught:
            await api.today()
    assert caught.value.status == 401
