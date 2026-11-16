import { describe, expect, it } from "vitest"
import { fold, matchByName, parseQuickAdd, type QuickAccount, type QuickCategory } from "./quick-add"

const categories: QuickCategory[] = [
  { id: "food", name: "Food & drinks", kind: "expense" },
  { id: "eat", name: "Eating out", kind: "expense" },
  { id: "transport", name: "Transport", kind: "expense" },
  { id: "salary", name: "Salary", kind: "income" },
  { id: "dum", name: "Domácnost", kind: "expense" },
]
const accounts: QuickAccount[] = [
  { id: "bank", name: "Current account" },
  { id: "cash", name: "Cash" },
]
const opts = { categories, accounts, today: "2026-11-16", defaultAccountId: "bank" }

describe("parseQuickAdd", () => {
  it("reads amount, category and note", () => {
    expect(parseQuickAdd("250 food lunch", opts)).toEqual({
      ok: true,
      amountMinor: -25000,
      categoryId: "food",
      accountId: "bank",
      occurredOn: "2026-11-16",
      note: "lunch",
      tags: [],
    })
  })

  it("signs by the category kind unless the sign is written", () => {
    expect(parseQuickAdd("45000 salary", opts)).toMatchObject({ amountMinor: 4_500_000, categoryId: "salary" })
    expect(parseQuickAdd("+120 refund from shop", opts)).toMatchObject({ amountMinor: 12000, categoryId: null, note: "refund from shop" })
    expect(parseQuickAdd("-500 salary correction", opts)).toMatchObject({ amountMinor: -50000 })
  })

  it("matches two-word names, accents and prefixes", () => {
    expect(parseQuickAdd("890 eating out pizza", opts)).toMatchObject({ categoryId: "eat", note: "pizza" })
    expect(parseQuickAdd("300 domacnost", opts)).toMatchObject({ categoryId: "dum", note: "" })
    expect(parseQuickAdd("32 trans bus", opts)).toMatchObject({ categoryId: "transport", note: "bus" })
  })

  it("reads decimals, account, tags and dates", () => {
    expect(parseQuickAdd("89,90 food @cash #coffee yesterday latte", opts)).toEqual({
      ok: true,
      amountMinor: -8990,
      categoryId: "food",
      accountId: "cash",
      occurredOn: "2026-11-15",
      note: "latte",
      tags: ["coffee"],
    })
    expect(parseQuickAdd("100 food 2.11.", opts)).toMatchObject({ occurredOn: "2026-11-02" })
    expect(parseQuickAdd("100 food 2026-10-01", opts)).toMatchObject({ occurredOn: "2026-10-01" })
  })

  it("keeps unknown words as the note", () => {
    expect(parseQuickAdd("250 gift for mum", opts)).toMatchObject({ categoryId: null, note: "gift for mum", amountMinor: -25000 })
  })

  it("explains what's missing", () => {
    expect(parseQuickAdd("", opts).ok).toBe(false)
    expect(parseQuickAdd("food lunch", opts)).toEqual({ ok: false, error: "Start with an amount, e.g. “250 food lunch”." })
    expect(parseQuickAdd("250 @nowhere", opts)).toEqual({ ok: false, error: "No account matches “nowhere”." })
  })
})

describe("matching", () => {
  it("folds accents and punctuation", () => {
    expect(fold("Jídlo & pití")).toBe("jidlo piti")
    expect(matchByName(categories, "fo")).toBeNull()
    expect(matchByName(categories, "drinks")?.id).toBe("food")
  })
})
