import { beforeEach, describe, expect, it, vi } from "vitest"

// The brief reads everything through module actions and the delivery log;
// those are faked here, so this checks what the card is made of and when it
// is due. db/tests/osbot-brief.test.ts runs the same against Postgres.

const state = vi.hoisted(() => ({
  modules: new Set(["tasks", "habits", "budget"]),
  settings: { briefEnabled: true, briefTime: "08:00" },
  delivered: new Set<string>(),
  actions: {} as Record<string, unknown>,
}))

vi.mock("server-only", () => ({}))
vi.mock("@/core/auth", () => ({ asViewer: vi.fn(async () => state.settings) }))
vi.mock("@/core/module-actions", () => ({
  hasModule: vi.fn(async (id: string) => state.modules.has(id)),
  runModuleAction: vi.fn(async (module: string, name: string, input: unknown) => {
    const value = state.actions[`${module}.${name}`]
    return typeof value === "function" ? value(input) : value
  }),
}))
vi.mock("./deliveries", () => ({
  deliveredKeys: vi.fn(async (_kind: string, keys: string[]) => new Set(keys.filter((k) => state.delivered.has(k)))),
  recordDeliveries: vi.fn(async (_kind: string, keys: string[]) => keys.filter((k) => !state.delivered.has(k)).length),
}))
vi.mock("./service", () => ({
  today: vi.fn(async () => ({
    date: "Wednesday 25 Nov",
    day: "2026-11-25",
    timezone: "Europe/Prague",
    events: [{ title: "Dentist", location: "Vinohradská 1", allDay: false, start: "", end: "", time: "14:00 – 15:00" }],
    tasks: [
      { id: "t-old", title: "Pay rent", overdue: true, dueDate: "2026-11-20", time: null, url: "u1" },
      { id: "t-now", title: "Call the bank", overdue: false, dueDate: "2026-11-25", time: "10:00", url: "u2" },
    ],
    tasksTotal: 2,
    newFeedback: 0,
    url: "x",
  })),
}))

const { ackBrief, briefDue, morningBrief } = await import("./brief")

const limit = (name: string, limitMinor: number, spentMinor: number) => ({
  categoryId: name,
  name,
  color: "",
  limitMinor,
  spentMinor,
  leftMinor: limitMinor - spentMinor,
  percent: Math.floor((spentMinor / limitMinor) * 100),
  status: "ok",
  paceMinor: null,
  averageMinor: 0,
})

beforeEach(() => {
  process.env.BETTER_AUTH_URL = "https://os.example"
  state.modules = new Set(["tasks", "habits", "budget"])
  state.settings = { briefEnabled: true, briefTime: "08:00" }
  state.delivered = new Set()
  state.actions = {
    "tasks.counts": { overdue: 1, today: 1 },
    "habits.today": {
      date: "2026-11-25",
      habits: [
        { id: "h1", name: "Stretch", emoji: "🧘", done: true, current: 3 },
        { id: "h2", name: "Read", emoji: "", done: false, current: 0 },
      ],
    },
    "budget.overview": { baseCurrency: "CZK", expenseMinor: 1_240_000, netMinor: 300_000 },
    "budget.limits": {
      month: "2026-11",
      items: [limit("Food", 500_000, 460_000), limit("Fun", 200_000, 50_000), limit("Taxi", 100_000, 120_000)],
    },
    "budget.getPlan": { plan: null, rows: [] },
    "budget.upcomingPayments": [
      { recurringId: "r1", note: "Netflix", amountMinor: 29_900, currency: "CZK", date: "2026-11-25", subscription: true, categoryName: null, accountName: "" },
    ],
  }
})

describe("morningBrief", () => {
  it("collects the day: calendar, today's tasks and the overdue count, habits, money and payments", async () => {
    const brief = await morningBrief("Europe/Prague", new Date("2026-11-25T07:00:00Z"))
    expect(brief).toMatchObject({
      date: "2026-11-25",
      label: "Wednesday 25 Nov",
      events: [{ title: "Dentist", time: "14:00 – 15:00", location: "Vinohradská 1" }],
      tasksToday: 1,
      overdue: 1,
      clear: false,
      delivered: false,
      url: "https://os.example/app",
    })
    // Only today's tasks are listed (numbered by the bot); the overdue one is a count.
    expect(brief.tasks.map((t) => t.id)).toEqual(["t-now"])
    expect(brief.habits).toEqual({
      date: "2026-11-25",
      habits: (state.actions["habits.today"] as { habits: unknown[] }).habits,
      done: 1,
      total: 2,
      url: "https://os.example/app/habits",
    })
    expect(brief.money).toEqual({
      currency: "CZK",
      month: "2026-11",
      spentMinor: 1_240_000,
      limits: { limitMinor: 800_000, spentMinor: 630_000, leftMinor: 170_000 },
      // ≥ 90 %, fullest first; Fun at 25 % is left out.
      near: [
        { name: "Taxi", percent: 120, leftMinor: -20_000 },
        { name: "Food", percent: 92, leftMinor: 40_000 },
      ],
      plan: null,
      url: "https://os.example/app/budget/limits",
    })
    expect(brief.payments).toEqual({
      items: [{ title: "Netflix", amountMinor: 29_900, currency: "CZK", subscription: true }],
      url: "https://os.example/app/budget/subscriptions",
    })
  })

  it("falls back to the savings plan without limits", async () => {
    state.actions["budget.limits"] = { month: "2026-11", items: [] }
    state.actions["budget.getPlan"] = { plan: { currency: "CZK", monthlyContributionMinor: 1_000_000 }, rows: [] }
    const brief = await morningBrief("Europe/Prague")
    expect(brief.money).toMatchObject({ limits: null, near: [], plan: { monthlyContributionMinor: 1_000_000, monthNetMinor: 300_000 } })
    expect(brief.money!.url).toBe("https://os.example/app/budget")
  })

  it("leaves out modules that are off, and calls an empty day clear", async () => {
    const { today } = await import("./service")
    vi.mocked(today).mockResolvedValueOnce({
      date: "Wednesday 25 Nov",
      day: "2026-11-25",
      timezone: "Europe/Prague",
      events: [],
      tasks: [],
      tasksTotal: 0,
      newFeedback: 0,
      url: "x",
    })
    state.modules = new Set(["tasks"])
    state.actions["tasks.counts"] = { overdue: 0, today: 0 }
    const brief = await morningBrief("Europe/Prague")
    expect(brief).toMatchObject({ habits: null, money: null, payments: null, tasks: [], overdue: 0, clear: true })
  })

  it("is not clear while something is overdue", async () => {
    const { today } = await import("./service")
    vi.mocked(today).mockResolvedValueOnce({ date: "", day: "2026-11-25", timezone: "", events: [], tasks: [], tasksTotal: 1, newFeedback: 0, url: "" })
    state.modules = new Set(["tasks"])
    expect((await morningBrief("Europe/Prague")).clear).toBe(false)
  })
})

describe("briefDue", () => {
  const TZ = "Europe/Prague"

  it("is due from the brief's time until three hours later, once a day", async () => {
    expect(await briefDue(TZ, new Date("2026-11-25T06:59:00Z"))).toEqual({ due: false, date: "2026-11-25", time: "08:00", brief: null })
    const due = await briefDue(TZ, new Date("2026-11-25T07:00:00Z"))
    expect(due).toMatchObject({ due: true, date: "2026-11-25", time: "08:00" })
    expect(due.brief?.date).toBe("2026-11-25")
    // Sent and acked: not again that day.
    expect(await ackBrief({ date: "2026-11-25" })).toEqual({ acked: 1 })
    state.delivered.add("2026-11-25")
    expect((await briefDue(TZ, new Date("2026-11-25T07:01:00Z"))).due).toBe(false)
  })

  it("skips a brief more than three hours late (the bot was down)", async () => {
    expect((await briefDue(TZ, new Date("2026-11-25T09:59:00Z"))).due).toBe(true)
    expect(await briefDue(TZ, new Date("2026-11-25T10:00:00Z"))).toMatchObject({ due: false, brief: null })
  })

  it("follows the owner's time and switch", async () => {
    state.settings = { briefEnabled: true, briefTime: "06:30" }
    expect((await briefDue(TZ, new Date("2026-11-25T05:30:00Z"))).due).toBe(true)
    state.settings = { briefEnabled: false, briefTime: "06:30" }
    expect((await briefDue(TZ, new Date("2026-11-25T05:30:00Z"))).due).toBe(false)
  })
})
