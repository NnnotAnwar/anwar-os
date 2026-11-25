import { beforeEach, describe, expect, it, vi } from "vitest"

// When osbot's evening question goes out, with the journal and the delivery
// log faked. db/tests/journal.test.ts runs the endpoints against Postgres.

const state = vi.hoisted(() => ({
  settings: { promptEnabled: true, promptTime: "21:30" },
  delivered: new Set<string>(),
  entries: new Map<string, { mood: number | null; text: string }>(),
}))

vi.mock("server-only", () => ({}))
vi.mock("@/core/auth", () => ({ asViewer: vi.fn(async () => state.settings) }))
vi.mock("@/modules/osbot/deliveries", () => ({
  deliveredKeys: vi.fn(async (_kind: string, keys: string[]) => new Set(keys.filter((k) => state.delivered.has(k)))),
  recordDeliveries: vi.fn(async (_kind: string, keys: string[]) => keys.length),
}))
vi.mock("./actions", () => ({
  JournalInputError: class extends Error {},
  readSettings: vi.fn(),
  upsertEntry: vi.fn(),
  actions: { get: { handler: vi.fn(async ({ day }: { day: string }) => state.entries.get(day) ?? null) } },
}))

const { journalDue, saveFromBot } = await import("./osbot")
const TZ = "Europe/Prague"

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://os.example"
  state.settings = { promptEnabled: true, promptTime: "21:30" }
  state.delivered = new Set()
  state.entries = new Map()
})

describe("journalDue", () => {
  it("asks from its time until three hours later, about the day it started on", async () => {
    // 21:29 Prague (UTC+1).
    expect(await journalDue(TZ, new Date("2026-11-25T20:29:00Z"))).toEqual({ due: false, date: "2026-11-25", time: "21:30", card: null })
    const due = await journalDue(TZ, new Date("2026-11-25T20:30:00Z"))
    expect(due).toMatchObject({ due: true, date: "2026-11-25" })
    expect(due.card).toEqual({
      date: "2026-11-25",
      today: "2026-11-25",
      label: "Wednesday 25 Nov",
      short: "Wed 25 Nov 2026",
      entry: null,
      url: "https://os.example/app/journal?day=2026-11-25",
    })
    // 00:15 on the 26th: still asking about the 25th.
    const late = await journalDue(TZ, new Date("2026-11-25T23:15:00Z"))
    expect(late).toMatchObject({ due: true, date: "2026-11-25", card: { date: "2026-11-25", today: "2026-11-26" } })
    // 00:30 on the 26th: too late, skipped.
    expect((await journalDue(TZ, new Date("2026-11-25T23:30:00Z"))).due).toBe(false)
  })

  it("isn't sent twice, nor when the day already has a mood", async () => {
    const now = new Date("2026-11-25T20:45:00Z")
    state.entries.set("2026-11-25", { mood: null, text: "Wrote a line in the app" })
    expect((await journalDue(TZ, now)).card?.entry).toEqual({ mood: null, text: "Wrote a line in the app" })
    state.entries.set("2026-11-25", { mood: 4, text: "" })
    expect((await journalDue(TZ, now)).due).toBe(false)
    state.entries.clear()
    state.delivered.add("2026-11-25")
    expect((await journalDue(TZ, now)).due).toBe(false)
  })

  it("stays quiet when switched off", async () => {
    state.settings = { promptEnabled: false, promptTime: "21:30" }
    expect((await journalDue(TZ, new Date("2026-11-25T20:45:00Z"))).due).toBe(false)
  })
})

describe("saveFromBot", () => {
  it("refuses a reply far over the limit with a message the bot can show", async () => {
    await expect(saveFromBot({ date: "2026-11-25", text: "x".repeat(501) }, TZ)).rejects.toThrow(/under 500 characters/)
  })
})
