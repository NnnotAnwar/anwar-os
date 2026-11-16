import { describe, expect, it } from "vitest"
import {
  ACTIVITY_LEVELS,
  bmr,
  calculateCalories,
  goalTarget,
  macroSplit,
  tdee,
  validateCalories,
  type CaloriesInput,
} from "./calories"

const man: CaloriesInput = {
  sex: "male",
  age: 30,
  heightCm: 180,
  weightKg: 80,
  activity: "moderate",
  goal: "maintain",
}

describe("bmr (Mifflin–St Jeor)", () => {
  it("adds 5 kcal for men", () => {
    // 10·80 + 6.25·180 − 5·30 + 5
    expect(bmr("male", 80, 180, 30)).toBe(1780)
  })

  it("subtracts 161 kcal for women", () => {
    // 10·60 + 6.25·165 − 5·25 − 161
    expect(bmr("female", 60, 165, 25)).toBeCloseTo(1345.25, 10)
  })

  it("differs by exactly 166 kcal between sexes with the same body", () => {
    expect(bmr("male", 70, 170, 40) - bmr("female", 70, 170, 40)).toBe(166)
  })

  it("drops 5 kcal per year of age", () => {
    expect(bmr("male", 80, 180, 31) - bmr("male", 80, 180, 30)).toBe(-5)
  })
})

describe("tdee", () => {
  it("uses the standard activity multipliers", () => {
    expect(Object.values(ACTIVITY_LEVELS).map((a) => a.factor)).toEqual([1.2, 1.375, 1.55, 1.725, 1.9])
    expect(tdee(1780, "sedentary")).toBeCloseTo(2136, 10)
    expect(tdee(1780, "moderate")).toBeCloseTo(2759, 10)
    expect(tdee(1780, "veryActive")).toBeCloseTo(3382, 10)
  })
})

describe("goalTarget", () => {
  it("applies a 20% deficit, no change, or a 10% surplus", () => {
    expect(goalTarget(2500, "lose")).toBeCloseTo(2000, 10)
    expect(goalTarget(2500, "maintain")).toBe(2500)
    expect(goalTarget(2500, "gain")).toBeCloseTo(2750, 10)
  })
})

describe("macroSplit", () => {
  it("fixes protein by weight, fat by share and gives carbs the rest", () => {
    const { macros, noRoomForCarbs } = macroSplit(2000, 80, 2, 25)
    expect(macros.protein).toEqual({ grams: 160, kcal: 640 })
    expect(macros.fat.kcal).toBe(500)
    expect(macros.fat.grams).toBeCloseTo(55.556, 3)
    expect(macros.carbs.kcal).toBe(860)
    expect(macros.carbs.grams).toBe(215)
    expect(noRoomForCarbs).toBe(false)
  })

  it("adds up to the target", () => {
    const { macros } = macroSplit(2345, 72, 1.6, 30)
    expect(macros.protein.kcal + macros.fat.kcal + macros.carbs.kcal).toBeCloseTo(2345, 8)
  })

  it("uses 1.8 g/kg protein and 25% fat by default", () => {
    const { macros } = macroSplit(2000, 50)
    expect(macros.protein.grams).toBe(90)
    expect(macros.fat.kcal).toBe(500)
  })

  it("never returns negative carbs", () => {
    const { macros, noRoomForCarbs } = macroSplit(1000, 150, 3, 40)
    expect(macros.carbs).toEqual({ grams: 0, kcal: 0 })
    expect(noRoomForCarbs).toBe(true)
  })
})

describe("calculateCalories", () => {
  it("chains BMR, TDEE, goal and macros", () => {
    const res = calculateCalories({ ...man, goal: "lose" })
    if (!res.ok) throw new Error("expected ok")
    expect(res.result.bmr).toBe(1780)
    expect(res.result.tdee).toBeCloseTo(2759, 10)
    expect(res.result.target).toBeCloseTo(2207.2, 10)
    expect(res.result.macros.protein.grams).toBeCloseTo(144, 10)
    expect(res.result.macros.fat.kcal).toBeCloseTo(551.8, 10)
    expect(res.result.macros.carbs.grams).toBeCloseTo(269.85, 10)
    expect(res.result.warnings).toEqual([])
  })

  it("warns when the target falls below BMR", () => {
    const res = calculateCalories({ ...man, activity: "sedentary", goal: "lose" })
    if (!res.ok) throw new Error("expected ok")
    // 1780 · 1.2 · 0.8 = 1708.8 < 1780
    expect(res.result.warnings).toContain("belowBmr")
  })

  it("warns when protein and fat leave no room for carbs", () => {
    const res = calculateCalories({
      sex: "female",
      age: 80,
      heightCm: 150,
      weightKg: 120,
      activity: "sedentary",
      goal: "lose",
      proteinPerKg: 3.5,
      fatPercent: 60,
    })
    if (!res.ok) throw new Error("expected ok")
    expect(res.result.warnings).toContain("noRoomForCarbs")
    expect(res.result.macros.carbs.kcal).toBe(0)
  })

  it("rejects out-of-range and non-numeric fields", () => {
    const res = calculateCalories({ ...man, age: 12, heightCm: Number.NaN, weightKg: 500 })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.errors).toEqual({
      age: "Use 15–100 years",
      heightCm: "Enter a number",
      weightKg: "Use 30–300 kg",
    })
  })

  it("validates optional macro settings only when given", () => {
    expect(validateCalories(man)).toEqual({})
    expect(validateCalories({ ...man, proteinPerKg: 5, fatPercent: 5 })).toEqual({
      proteinPerKg: "Use 0.5–3.5 g/kg",
      fatPercent: "Use 10–60%",
    })
  })

  it("accepts the range boundaries", () => {
    expect(validateCalories({ ...man, age: 15, heightCm: 250, weightKg: 30 })).toEqual({})
  })
})
