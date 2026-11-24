import { describe, expect, it } from "vitest"
import { compareCategories, percentChange } from "./compare"

const t = (id: string | null, name: string, amountMinor: number) => ({ id, name, color: null, amountMinor })

describe("compareCategories", () => {
  it("joins both months by category, biggest this month first", () => {
    const { categories } = compareCategories(
      [t("a", "Food", 500_00), t("b", "Rent", 1500_00), t(null, "Uncategorised", 20_00)],
      [t("a", "Food", 400_00), t("c", "Travel", 300_00), t(null, "Uncategorised", 20_00)],
    )
    expect(categories.map((c) => [c.name, c.amountMinor, c.previousMinor])).toEqual([
      ["Rent", 1500_00, 0],
      ["Food", 500_00, 400_00],
      ["Uncategorised", 20_00, 20_00],
      ["Travel", 0, 300_00],
    ])
  })

  it("lists the three biggest moves either way, skipping unchanged ones", () => {
    const { changes } = compareCategories(
      [t("a", "Food", 500_00), t("b", "Rent", 1500_00), t("d", "Fun", 10_00), t("e", "Same", 50_00)],
      [t("a", "Food", 400_00), t("b", "Rent", 1500_00), t("c", "Travel", 300_00), t("e", "Same", 50_00), t("d", "Fun", 5_00)],
    )
    expect(changes.map((c) => c.name)).toEqual(["Travel", "Food", "Fun"])
  })

  it("treats amounts as positive whatever their sign", () => {
    const { categories } = compareCategories([t("a", "Food", -500)], [])
    expect(categories[0]!.amountMinor).toBe(500)
  })
})

describe("percentChange", () => {
  it("rounds to whole percent", () => {
    expect(percentChange(150, 100)).toBe(50)
    expect(percentChange(50, 150)).toBe(-67)
    expect(percentChange(100, 100)).toBe(0)
  })

  it("is null without a previous figure", () => {
    expect(percentChange(100, 0)).toBeNull()
  })
})
