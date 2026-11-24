import { readFileSync } from "node:fs"
import { IDBFactory } from "fake-indexeddb"
import { afterEach, describe, expect, it } from "vitest"
import { BACKGROUND_SYNC_TAG, PAGES_CACHE_PREFIX, SYNC_LOCK } from "./client"
import { OUTBOX_DB, OUTBOX_DB_VERSION, OUTBOX_STORE, openOutbox, type Outbox } from "./outbox"

let box: Outbox | null = null
afterEach(() => {
  box?.close()
  box = null
})

async function fresh() {
  box = await openOutbox(new IDBFactory())
  return box
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

describe("outbox", () => {
  it("keeps items in capture order, per user", async () => {
    const outbox = await fresh()
    await outbox.add({ id: uuid(3), kind: "inbox", payload: { text: "first" }, userId: "u1" })
    await outbox.add({ id: uuid(1), kind: "task", payload: { text: "second" }, userId: "u2" })
    await outbox.add({ id: uuid(2), kind: "note", payload: { title: "third", body: "" }, userId: "u1" })

    expect((await outbox.list()).map((i) => i.payload)).toEqual([{ text: "first" }, { text: "second" }, { title: "third", body: "" }])
    const mine = await outbox.list("u1")
    expect(mine.map((i) => i.id)).toEqual([uuid(3), uuid(2)])
    expect(mine[0]).toMatchObject({ status: "pending", attempts: 0, error: null, userId: "u1", kind: "inbox" })
    expect(Date.parse(mine[0]!.capturedAt)).not.toBeNaN()
  })

  it("refuses a second item with the same id", async () => {
    const outbox = await fresh()
    await outbox.add({ id: uuid(1), kind: "inbox", payload: { text: "a" }, userId: "u1" })
    await expect(outbox.add({ id: uuid(1), kind: "inbox", payload: { text: "b" }, userId: "u1" })).rejects.toBeTruthy()
    expect(await outbox.list()).toHaveLength(1)
  })

  it("amends only items still waiting", async () => {
    const outbox = await fresh()
    await outbox.add({ id: uuid(1), kind: "note", payload: { title: "Draft", body: "" }, userId: "u1" })
    expect(await outbox.amend(uuid(1), { title: "Draft", body: "more" })).toBe(true)
    expect((await outbox.get(uuid(1)))?.payload).toEqual({ title: "Draft", body: "more" })

    await outbox.markFailed(uuid(1), "Too long")
    expect(await outbox.amend(uuid(1), { title: "x", body: "" })).toBe(false)
    expect(await outbox.amend(uuid(9), { title: "x", body: "" })).toBe(false)
  })

  it("records attempts, failures and retries", async () => {
    const outbox = await fresh()
    await outbox.add({ id: uuid(1), kind: "expense", payload: { text: "250 coffee" }, userId: "u1" })
    await outbox.noteAttempt(uuid(1), "offline")
    expect(await outbox.get(uuid(1))).toMatchObject({ status: "pending", attempts: 1, error: "offline" })

    await outbox.markFailed(uuid(1), "Add an account first.")
    expect(await outbox.get(uuid(1))).toMatchObject({ status: "failed", attempts: 2, error: "Add an account first." })

    await outbox.retry(uuid(1))
    expect(await outbox.get(uuid(1))).toMatchObject({ status: "pending", error: null })
  })

  it("clears one user's items or all of them", async () => {
    const outbox = await fresh()
    await outbox.add({ id: uuid(1), kind: "inbox", payload: { text: "a" }, userId: "u1" })
    await outbox.add({ id: uuid(2), kind: "inbox", payload: { text: "b" }, userId: "u2" })
    await outbox.clear("u1")
    expect((await outbox.list()).map((i) => i.userId)).toEqual(["u2"])
    await outbox.clear()
    expect(await outbox.list()).toEqual([])
  })

  it("survives reopening (a reload)", async () => {
    const factory = new IDBFactory()
    const first = await openOutbox(factory)
    await first.add({ id: uuid(1), kind: "inbox", payload: { text: "kept" }, userId: "u1" })
    first.close()
    box = await openOutbox(factory)
    expect((await box.list()).map((i) => i.payload.text)).toEqual(["kept"])
  })
})

describe("the service worker's copy of the outbox contract", () => {
  const sw = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8")
  const constant = (name: string) => sw.match(new RegExp(`const ${name} = "?([^"\\n]+)"?`))?.[1]

  it("uses the same database, store, lock and sync tag", () => {
    expect(constant("OUTBOX_DB")).toBe(OUTBOX_DB)
    expect(constant("OUTBOX_DB_VERSION")).toBe(String(OUTBOX_DB_VERSION))
    expect(constant("OUTBOX_STORE")).toBe(OUTBOX_STORE)
    expect(constant("SYNC_LOCK")).toBe(SYNC_LOCK)
    expect(constant("BACKGROUND_SYNC_TAG")).toBe(BACKGROUND_SYNC_TAG)
    expect(sw).toContain(`const PAGES_CACHE = \`${PAGES_CACHE_PREFIX}v\${PAGES_VERSION}\``)
  })
})
