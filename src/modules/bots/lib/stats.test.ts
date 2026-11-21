import { describe, expect, it } from "vitest"
import { botInput } from "../schema"
import { counterLabel, fillDays, formatMoney, liveness, readOverview } from "./stats"

const now = new Date("2026-11-16T12:00:00Z")

describe("liveness", () => {
  it("is alive within three minutes of the last beat", () => {
    expect(liveness("2026-11-16T11:58:30Z", now)).toEqual({ state: "alive", label: "Alive" })
  })

  it("says how long a bot has been silent", () => {
    expect(liveness("2026-11-16T11:48:00Z", now)).toEqual({ state: "silent", label: "Silent for 12 min" })
    expect(liveness("2026-11-16T07:00:00Z", now).label).toBe("Silent for 5 h")
    expect(liveness("2026-11-12T12:00:00Z", now).label).toBe("Silent for 4 d")
  })

  it("knows a bot that never reported", () => {
    expect(liveness(null, now)).toEqual({ state: "never", label: "No heartbeat yet" })
  })
})

describe("readOverview", () => {
  it("reads the expense bot's view and picks up domain counters and money", () => {
    const o = readOverview({
      total_users: 4,
      active_users_7d: 2,
      active_users_30d: 3,
      total_expenses: "120",
      total_amounts_minor: { CZK: 2827060 },
      last_heartbeat_at: new Date("2026-11-16T11:59:30Z"),
      bot_version: "1cb24b4",
    })
    expect(o).toEqual({
      users: 4,
      active7d: 2,
      active30d: 3,
      counters: [{ label: "Expenses", value: 120 }],
      amounts: { CZK: 2827060 },
      lastBeatAt: "2026-11-16T11:59:30.000Z",
      version: "1cb24b4",
    })
  })

  it("tolerates a minimal view", () => {
    expect(readOverview({})).toMatchObject({ users: null, counters: [], amounts: {}, lastBeatAt: null })
  })

  it("labels counters", () => {
    expect(counterLabel("total_expenses")).toBe("Expenses")
    expect(counterLabel("total_voice_notes")).toBe("Voice notes")
  })
})

describe("formatting", () => {
  it("formats minor units per currency", () => {
    expect(formatMoney(2827060, "CZK", "en").replace(/\s/g, " ")).toBe("CZK 28,271")
    expect(formatMoney(1050, "EUR", "en")).toBe("€11")
  })

  it("zero-fills the last two weeks", () => {
    const days = fillDays([{ day: "2026-11-15", messages: 5, activeUsers: 2, expenses: 1 }], "2026-11-16", 3)
    expect(days.map((d) => [d.day, d.messages])).toEqual([
      ["2026-11-14", 0],
      ["2026-11-15", 5],
      ["2026-11-16", 0],
    ])
  })
})

describe("bot input", () => {
  it("normalizes optional fields and strips the @", () => {
    const parsed = botInput.parse({
      name: " Expenses ",
      telegramUsername: "@expenses_bot",
      serviceName: "",
      statsSource: "bot_expenses",
      description: "",
    })
    expect(parsed).toEqual({
      name: "Expenses",
      telegramUsername: "expenses_bot",
      serviceName: null,
      statsSource: "bot_expenses",
      description: "",
    })
  })

  it("refuses schemas that aren't a bot's", () => {
    expect(botInput.safeParse({ name: "x", telegramUsername: "", serviceName: "", statsSource: "public", description: "" }).success).toBe(false)
    expect(botInput.safeParse({ name: "x", telegramUsername: "", serviceName: "", statsSource: "osbot", description: "" }).success).toBe(true)
  })
})
