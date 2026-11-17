import { describe, expect, it } from "vitest"
import { budgetAccountKinds, budgetCategoryKinds, budgetRecurringFreqs } from "@/db/schema/budget"
import { monthlyNeeded } from "./lib/goals"
import { categoryGroups } from "./components/types"
import { accountKinds, categoryKinds, createRecurringInput, planInput, recurringFreqs, transactionFields } from "./schema"

describe("budget schema", () => {
  it("mirrors the database enums", () => {
    expect(accountKinds).toEqual(budgetAccountKinds)
    expect(categoryKinds).toEqual(budgetCategoryKinds)
    expect(recurringFreqs).toEqual(budgetRecurringFreqs)
  })

  const uuid = "6f1d9a2e-3b4c-4d5e-8f60-718293a4b5c6"

  it("validates transactions", () => {
    const ok = transactionFields.safeParse({ accountId: uuid, amountMinor: -25000, occurredOn: "2026-11-16" })
    expect(ok.success && ok.data).toMatchObject({ categoryId: null, note: "", tags: [] })
    expect(transactionFields.safeParse({ accountId: uuid, amountMinor: 0, occurredOn: "2026-11-16" }).success).toBe(false)
    expect(transactionFields.safeParse({ accountId: uuid, amountMinor: 1.5, occurredOn: "2026-11-16" }).success).toBe(false)
    expect(transactionFields.safeParse({ accountId: uuid, amountMinor: 100, occurredOn: "2026-02-30" }).success).toBe(false)
  })

  it("keeps recurring ends after starts and plans in range", () => {
    const base = { accountId: uuid, amountMinor: -1, note: "Rent", startOn: "2026-11-01" }
    expect(createRecurringInput.safeParse({ ...base, endOn: "2026-10-01" }).success).toBe(false)
    expect(createRecurringInput.safeParse({ ...base, endOn: "2026-12-01" }).success).toBe(true)
    const plan = { startingCapitalMinor: 0, monthlyContributionMinor: 100, annualReturnBp: 700, horizonYears: 10, startMonth: "2026-11" }
    expect(planInput.safeParse(plan).success).toBe(true)
    expect(planInput.safeParse({ ...plan, horizonYears: 0 }).success).toBe(false)
    expect(planInput.safeParse({ ...plan, startMonth: "2026-13" }).success).toBe(false)
  })
})

describe("goal pace", () => {
  it("spreads what's left over the whole months to the deadline", () => {
    expect(monthlyNeeded({ targetMinor: 120_000, progressMinor: 0, deadline: "2027-11-30" }, "2026-11-17")).toBe(10_000)
    expect(monthlyNeeded({ targetMinor: 120_000, progressMinor: 0, deadline: "2026-11-30" }, "2026-11-17")).toBe(120_000)
    expect(monthlyNeeded({ targetMinor: 100, progressMinor: 150, deadline: "2027-01-01" }, "2026-11-17")).toBe(0)
    expect(monthlyNeeded({ targetMinor: 100, progressMinor: 0, deadline: null }, "2026-11-17")).toBeNull()
  })
})

describe("category pickers", () => {
  it("lists parents followed by their children per kind", () => {
    const groups = categoryGroups([
      { id: "f", name: "Food", kind: "expense", parentId: null, color: "teal" },
      { id: "g", name: "Groceries", kind: "expense", parentId: "f", color: "teal" },
      { id: "s", name: "Salary", kind: "income", parentId: null, color: "teal" },
      { id: "o", name: "Orphan", kind: "expense", parentId: "gone", color: "teal" },
    ])
    expect(groups.expense.map((g) => g.label)).toEqual(["Food", "Food › Groceries", "Orphan"])
    expect(groups.income.map((g) => g.id)).toEqual(["s"])
  })
})
