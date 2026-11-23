import { describe, expect, it } from "vitest"
import { sign, signedHeaders, verifyRequest, type SignedParts } from "@/lib/signed-request"
import { BOT_IMPORT_KEY, BUDGET_BOT_SIGNATURE_HEADERS, rankCategories, toBotExpense } from "./lib"

const SECRET = "test-secret-0123456789abcdef0123456789abcdef"
const NOW = 1_794_830_400_000
const parts: SignedParts = {
  timestamp: "1794830400",
  nonce: "abcdef0123456789abcdef",
  method: "POST",
  path: "/api/internal/budget-bot/expenses/quick",
  body: '{"text":"250 food lunch ✓"}',
}

describe("expense bot request signatures", () => {
  it("match the shared test vector (bots/expenses/tests/test_signing.py)", () => {
    expect(sign(SECRET, parts)).toBe("fde551cc4398412fb49928d0a96a9de3aaafa0aebdec48b0dd3e260e94a336f4")
  })

  it("use their own headers: an osbot-style signature is not accepted", () => {
    const headers = new Headers(signedHeaders(SECRET, { ...parts }, BUDGET_BOT_SIGNATURE_HEADERS))
    expect([...headers.keys()].sort()).toEqual(["x-budget-bot-nonce", "x-budget-bot-signature", "x-budget-bot-timestamp"])
    const ok = verifyRequest({ secret: SECRET, method: parts.method, path: parts.path, body: parts.body, headers, names: BUDGET_BOT_SIGNATURE_HEADERS, nowMs: NOW })
    expect(ok).toEqual({ ok: true })

    const osbot = new Headers({
      "x-osbot-timestamp": parts.timestamp,
      "x-osbot-nonce": parts.nonce,
      "x-osbot-signature": sign(SECRET, parts),
    })
    expect(
      verifyRequest({ ...parts, secret: SECRET, headers: osbot, names: BUDGET_BOT_SIGNATURE_HEADERS, nowMs: NOW }),
    ).toEqual({ ok: false, reason: "missing" })
  })
})

describe("expense shape", () => {
  it("turns a money-out transaction into a positive expense with its recording time", () => {
    expect(
      toBotExpense({
        id: "t1",
        amountMinor: -25050,
        currency: "CZK",
        categoryId: "c1",
        categoryName: "Food",
        note: "lunch",
        occurredOn: "2026-11-23",
        createdAt: new Date("2026-11-23T11:15:00.000Z"),
        accountId: "a1",
        accountName: "Main account",
      }),
    ).toEqual({
      id: "t1",
      amountMinor: 25050,
      currency: "CZK",
      categoryId: "c1",
      categoryName: "Food",
      note: "lunch",
      occurredOn: "2026-11-23",
      recordedAt: "2026-11-23T11:15:00.000Z",
      accountId: "a1",
      accountName: "Main account",
    })
  })

  it("import keys name a row of bot_expenses.expenses", () => {
    expect(BOT_IMPORT_KEY.test("bot-expenses:42")).toBe(true)
    expect(BOT_IMPORT_KEY.test("bot-expenses:")).toBe(false)
    expect(BOT_IMPORT_KEY.test("sqlite:42")).toBe(false)
    expect(BOT_IMPORT_KEY.test("bot-expenses:4 2")).toBe(false)
  })
})

describe("picker order", () => {
  const categories = [
    { id: "food", name: "Food" },
    { id: "fun", name: "Fun" },
    { id: "health", name: "Health" },
    { id: "other", name: "Other" },
  ]

  it("puts the most used first, ties by recency, the rest by name", () => {
    const ranked = rankCategories(categories, [
      { categoryId: "health", uses: 2, lastUsedAt: "2026-11-01 10:00:00+00" },
      { categoryId: "fun", uses: 2, lastUsedAt: "2026-11-20 10:00:00+00" },
      { categoryId: "other", uses: 5, lastUsedAt: "2026-10-01 10:00:00+00" },
    ])
    expect(ranked.map((c) => [c.id, c.uses])).toEqual([
      ["other", 5],
      ["fun", 2],
      ["health", 2],
      ["food", 0],
    ])
  })

  it("keeps name order without any usage", () => {
    expect(rankCategories(categories, []).map((c) => c.id)).toEqual(["food", "fun", "health", "other"])
  })
})
