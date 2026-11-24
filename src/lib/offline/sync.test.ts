import { IDBFactory } from "fake-indexeddb"
import { afterEach, describe, expect, it } from "vitest"
import { openOutbox, type Outbox, type OutboxItem } from "./outbox"
import { classifyResponse, retryDelay, sendItem, syncOutbox, type SendOutcome } from "./sync"

let box: Outbox | null = null
afterEach(() => {
  box?.close()
  box = null
})

async function outboxWith(items: { kind?: OutboxItem["kind"]; text: string; userId?: string }[]) {
  box = await openOutbox(new IDBFactory())
  for (const [n, item] of items.entries()) {
    await box.add({
      id: `00000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
      kind: item.kind ?? "inbox",
      payload: { text: item.text },
      userId: item.userId ?? "u1",
    })
  }
  return box
}

/**
 * A server with the real API's idempotency: rows keyed by the item's id, a
 * second send of the same id returns the existing row. `script` decides what
 * happens to each send (by text), e.g. commit the row but lose the answer.
 */
function fakeServer(script: Record<string, (sends: number) => "ok" | "lost-after-commit" | "offline" | "refuse" | "500" | "401"> = {}) {
  const rows = new Map<string, { text: string }>()
  const sends: string[] = []
  const send = async (item: OutboxItem): Promise<SendOutcome> => {
    const text = String(item.payload.text)
    sends.push(text)
    const what = script[text]?.(sends.filter((s) => s === text).length) ?? "ok"
    switch (what) {
      case "offline":
        return { type: "retry", error: "offline" }
      case "500":
        return { type: "retry", error: "server" }
      case "401":
        return { type: "signed-out" }
      case "refuse":
        return { type: "rejected", error: `No: ${text}` }
      case "lost-after-commit":
        if (!rows.has(item.id)) rows.set(item.id, { text })
        return { type: "retry", error: "connection dropped" }
      case "ok":
        if (!rows.has(item.id)) rows.set(item.id, { text })
        return { type: "ok", value: { id: item.id, ...rows.get(item.id) } }
    }
  }
  return { rows, sends, send }
}

describe("syncOutbox", () => {
  it("sends waiting items oldest first and removes them", async () => {
    const outbox = await outboxWith([{ text: "a" }, { text: "b", kind: "task" }, { text: "c", kind: "expense" }])
    const server = fakeServer()
    const seen: string[] = []
    const report = await syncOutbox({ outbox, userId: "u1", send: server.send, onSynced: (item) => seen.push(String(item.payload.text)) })

    expect(server.sends).toEqual(["a", "b", "c"])
    expect(seen).toEqual(["a", "b", "c"])
    expect(report).toMatchObject({ stopped: null, error: null, failed: [] })
    expect(report.synced.map((s) => s.value)).toEqual([...server.rows].map(([id, row]) => ({ id, ...row })))
    expect(await outbox.list()).toEqual([])
  })

  it("stops at a connection error so nothing overtakes, and resumes in order", async () => {
    const outbox = await outboxWith([{ text: "a" }, { text: "b" }, { text: "c" }])
    const server = fakeServer({ b: (n) => (n === 1 ? "offline" : "ok") })

    const first = await syncOutbox({ outbox, userId: "u1", send: server.send })
    expect(first).toMatchObject({ stopped: "retry", error: "offline" })
    expect(server.sends).toEqual(["a", "b"])
    expect((await outbox.list()).map((i) => [i.payload.text, i.attempts, i.status])).toEqual([
      ["b", 1, "pending"],
      ["c", 0, "pending"],
    ])

    const second = await syncOutbox({ outbox, userId: "u1", send: server.send })
    expect(second.stopped).toBeNull()
    expect(server.sends).toEqual(["a", "b", "b", "c"])
    expect([...server.rows.values()].map((r) => r.text)).toEqual(["a", "b", "c"])
  })

  it("never duplicates when the answer is lost after the server saved it", async () => {
    const outbox = await outboxWith([{ text: "coffee" }])
    const server = fakeServer({ coffee: (n) => (n === 1 ? "lost-after-commit" : "ok") })

    await syncOutbox({ outbox, userId: "u1", send: server.send })
    expect(await outbox.list()).toHaveLength(1)
    await syncOutbox({ outbox, userId: "u1", send: server.send })

    expect(server.sends).toEqual(["coffee", "coffee"])
    expect(server.rows.size).toBe(1)
    expect(await outbox.list()).toEqual([])
  })

  it("marks a refused item failed and carries on with the rest", async () => {
    const outbox = await outboxWith([{ text: "a" }, { text: "bad" }, { text: "c" }])
    const server = fakeServer({ bad: () => "refuse" })
    const report = await syncOutbox({ outbox, userId: "u1", send: server.send })

    expect(report.failed.map((f) => f.error)).toEqual(["No: bad"])
    expect(report.stopped).toBeNull()
    const left = await outbox.list()
    expect(left).toHaveLength(1)
    expect(left[0]).toMatchObject({ status: "failed", error: "No: bad", attempts: 1 })

    // A failed item waits for Retry or Discard: the next run leaves it alone.
    await syncOutbox({ outbox, userId: "u1", send: server.send })
    expect(server.sends.filter((s) => s === "bad")).toHaveLength(1)
    await outbox.retry(left[0]!.id)
    expect((await outbox.list())[0]!.status).toBe("pending")
  })

  it("stops and keeps everything when signed out", async () => {
    const outbox = await outboxWith([{ text: "a" }, { text: "b" }])
    const server = fakeServer({ a: () => "401" })
    const report = await syncOutbox({ outbox, userId: "u1", send: server.send })
    expect(report.stopped).toBe("signed-out")
    expect(server.sends).toEqual(["a"])
    expect(await outbox.list()).toHaveLength(2)
  })

  it("only sends the signed-in user's items", async () => {
    const outbox = await outboxWith([{ text: "mine" }, { text: "theirs", userId: "u2" }])
    const server = fakeServer()
    await syncOutbox({ outbox, userId: "u1", send: server.send })
    expect(server.sends).toEqual(["mine"])
    expect((await outbox.list()).map((i) => i.userId)).toEqual(["u2"])
  })

  it("skips items discarded or sent elsewhere since the run started", async () => {
    const outbox = await outboxWith([{ text: "a" }, { text: "b" }])
    const [, second] = await outbox.list()
    const server = fakeServer()
    const send = async (item: OutboxItem) => {
      // Another tab sends "b" while this run is busy with "a".
      if (item.payload.text === "a") await outbox.remove(second!.id)
      return server.send(item)
    }
    await syncOutbox({ outbox, userId: "u1", send })
    expect(server.sends).toEqual(["a"])
  })

  it("leaves another account's item alone when the server says so", async () => {
    const outbox = await outboxWith([{ text: "a" }])
    const report = await syncOutbox({ outbox, userId: "u1", send: async () => ({ type: "other-user" }) })
    expect(report).toMatchObject({ stopped: null, synced: [], failed: [] })
    expect((await outbox.list())[0]).toMatchObject({ status: "pending", attempts: 0 })
  })
})

describe("classifyResponse", () => {
  it.each([
    [200, { ok: true, value: { id: "x" } }, { type: "ok", value: { id: "x" } }],
    [401, { error: "unauthorized" }, { type: "signed-out" }],
    [409, { error: "other_user" }, { type: "other-user" }],
    [409, { error: "conflict", message: "Clash" }, { type: "rejected", error: "Clash" }],
    [422, { error: "rejected", message: "Add an account first." }, { type: "rejected", error: "Add an account first." }],
    [404, null, { type: "rejected", error: expect.stringContaining("didn't accept") }],
    [403, { message: "Sync only works from the app itself." }, { type: "rejected", error: "Sync only works from the app itself." }],
    [500, { error: "internal" }, { type: "retry", error: expect.any(String) }],
    [502, null, { type: "retry", error: expect.stringContaining("502") }],
    [429, null, { type: "retry", error: expect.any(String) }],
    [408, null, { type: "retry", error: expect.any(String) }],
    // A 200 that isn't our JSON (a captive portal page): not saved, try later.
    [200, null, { type: "retry", error: expect.any(String) }],
  ])("%i %j", (status, body, expected) => {
    expect(classifyResponse(status, body)).toEqual(expected)
  })
})

describe("sendItem", () => {
  const item: OutboxItem = {
    id: "00000000-0000-4000-8000-000000000001",
    kind: "expense",
    payload: { text: "250 coffee" },
    userId: "u1",
    capturedAt: "2026-11-23T22:50:00.000Z",
    seq: 1,
    status: "pending",
    attempts: 0,
    error: null,
    lastAttemptAt: null,
  }

  it("posts the item as JSON to its kind's route", async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const outcome = await sendItem(item, async (url, init) => {
      seen = { url, init }
      return Response.json({ ok: true, value: { id: item.id } })
    })
    expect(outcome).toEqual({ type: "ok", value: { id: item.id } })
    expect(seen!.url).toBe("/api/sync/expense")
    expect(seen!.init).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" } })
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      id: item.id,
      userId: "u1",
      capturedAt: item.capturedAt,
      payload: { text: "250 coffee" },
    })
  })

  it("treats a network error as try again later", async () => {
    const outcome = await sendItem(item, async () => {
      throw new TypeError("Failed to fetch")
    })
    expect(outcome.type).toBe("retry")
  })

  it("treats an HTML answer from a proxy as try again later", async () => {
    const outcome = await sendItem(item, async () => new Response("<html>Bad gateway</html>", { status: 502 }))
    expect(outcome.type).toBe("retry")
  })
})

describe("retryDelay", () => {
  it("backs off and caps at five minutes", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(retryDelay)).toEqual([5, 15, 30, 60, 120, 300, 300])
  })
})
