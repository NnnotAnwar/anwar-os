/**
 * Daily energy needs from the Mifflin–St Jeor equation. Metric units only:
 * kilograms, centimetres, years, kilocalories.
 */

export type Sex = "male" | "female"

export type ActivityLevel = "sedentary" | "light" | "moderate" | "active" | "veryActive"

export type Goal = "lose" | "maintain" | "gain"

/** Standard multipliers applied to BMR to estimate total daily energy expenditure. */
export const ACTIVITY_LEVELS: Record<ActivityLevel, { factor: number; label: string; hint: string }> = {
  sedentary: { factor: 1.2, label: "Sedentary", hint: "Desk job, little or no exercise" },
  light: { factor: 1.375, label: "Lightly active", hint: "Light exercise 1–3 days a week" },
  moderate: { factor: 1.55, label: "Moderately active", hint: "Exercise 3–5 days a week" },
  active: { factor: 1.725, label: "Very active", hint: "Hard exercise 6–7 days a week" },
  veryActive: { factor: 1.9, label: "Extra active", hint: "Physical job or training twice a day" },
}

/**
 * Goal adjustments as a fraction of TDEE. A relative deficit scales with body
 * size, unlike a flat −500 kcal: 20% under for losing, 10% over for gaining.
 */
export const GOALS: Record<Goal, { adjustment: number; label: string }> = {
  lose: { adjustment: -0.2, label: "Lose weight" },
  maintain: { adjustment: 0, label: "Maintain" },
  gain: { adjustment: 0.1, label: "Gain weight" },
}

export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 } as const

export const DEFAULT_PROTEIN_PER_KG = 1.8
export const DEFAULT_FAT_PERCENT = 25

/** Accepted input ranges. The equation was fitted on adults, so age starts at 15. */
export const LIMITS = {
  age: { min: 15, max: 100 },
  heightCm: { min: 100, max: 250 },
  weightKg: { min: 30, max: 300 },
  proteinPerKg: { min: 0.5, max: 3.5 },
  fatPercent: { min: 10, max: 60 },
} as const

export type CaloriesInput = {
  sex: Sex
  age: number
  heightCm: number
  weightKg: number
  activity: ActivityLevel
  goal: Goal
  /** Grams of protein per kilogram of body weight. */
  proteinPerKg?: number
  /** Share of target calories that comes from fat, in percent. */
  fatPercent?: number
}

export type Macros = {
  protein: { grams: number; kcal: number }
  fat: { grams: number; kcal: number }
  carbs: { grams: number; kcal: number }
}

export type CaloriesResult = {
  bmr: number
  tdee: number
  target: number
  macros: Macros
  warnings: CaloriesWarning[]
}

export type CaloriesWarning =
  /** Target intake is below resting metabolism. */
  | "belowBmr"
  /** Protein and fat already use up the target; carbs were clamped to zero. */
  | "noRoomForCarbs"

export type FieldErrors = Partial<Record<keyof typeof LIMITS, string>>

/** Basal metabolic rate in kcal/day (Mifflin–St Jeor, 1990). */
export function bmr(sex: Sex, weightKg: number, heightCm: number, age: number): number {
  return 10 * weightKg + 6.25 * heightCm - 5 * age + (sex === "male" ? 5 : -161)
}

/** Total daily energy expenditure: BMR times the activity multiplier. */
export function tdee(bmrKcal: number, activity: ActivityLevel): number {
  return bmrKcal * ACTIVITY_LEVELS[activity].factor
}

/** Daily intake target after applying the goal's surplus or deficit. */
export function goalTarget(tdeeKcal: number, goal: Goal): number {
  return tdeeKcal * (1 + GOALS[goal].adjustment)
}

/**
 * Splits a calorie target into macros: protein is fixed by body weight, fat is a
 * share of calories, and carbohydrates take whatever is left (never negative).
 */
export function macroSplit(
  targetKcal: number,
  weightKg: number,
  proteinPerKg = DEFAULT_PROTEIN_PER_KG,
  fatPercent = DEFAULT_FAT_PERCENT,
): { macros: Macros; noRoomForCarbs: boolean } {
  const proteinGrams = weightKg * proteinPerKg
  const proteinKcal = proteinGrams * KCAL_PER_GRAM.protein
  const fatKcal = (targetKcal * fatPercent) / 100
  const rest = targetKcal - proteinKcal - fatKcal
  const carbsKcal = Math.max(0, rest)
  return {
    macros: {
      protein: { grams: proteinGrams, kcal: proteinKcal },
      fat: { grams: fatKcal / KCAL_PER_GRAM.fat, kcal: fatKcal },
      carbs: { grams: carbsKcal / KCAL_PER_GRAM.carbs, kcal: carbsKcal },
    },
    noRoomForCarbs: rest < 0,
  }
}

function checkRange(value: number, key: keyof typeof LIMITS, unit: string): string | undefined {
  const { min, max } = LIMITS[key]
  if (!Number.isFinite(value)) return "Enter a number"
  if (value < min || value > max) return `Use ${min}–${max}${unit}`
  return undefined
}

/** Field-level validation. An empty object means the input is usable. */
export function validateCalories(input: CaloriesInput): FieldErrors {
  const errors: FieldErrors = {}
  const checks: [keyof typeof LIMITS, number | undefined, string][] = [
    ["age", input.age, " years"],
    ["heightCm", input.heightCm, " cm"],
    ["weightKg", input.weightKg, " kg"],
    ["proteinPerKg", input.proteinPerKg, " g/kg"],
    ["fatPercent", input.fatPercent, "%"],
  ]
  for (const [key, value, unit] of checks) {
    if (value === undefined) continue
    const error = checkRange(value, key, unit)
    if (error) errors[key] = error
  }
  return errors
}

export function calculateCalories(
  input: CaloriesInput,
): { ok: true; result: CaloriesResult } | { ok: false; errors: FieldErrors } {
  const errors = validateCalories(input)
  if (Object.keys(errors).length > 0) return { ok: false, errors }

  const base = bmr(input.sex, input.weightKg, input.heightCm, input.age)
  const daily = tdee(base, input.activity)
  const target = goalTarget(daily, input.goal)
  const { macros, noRoomForCarbs } = macroSplit(target, input.weightKg, input.proteinPerKg, input.fatPercent)

  const warnings: CaloriesWarning[] = []
  if (target < base) warnings.push("belowBmr")
  if (noRoomForCarbs) warnings.push("noRoomForCarbs")

  return { ok: true, result: { bmr: base, tdee: daily, target, macros, warnings } }
}
