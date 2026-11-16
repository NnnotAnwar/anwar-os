"use client"

import { useState } from "react"
import {
  ACTIVITY_LEVELS,
  calculateCalories,
  DEFAULT_FAT_PERCENT,
  DEFAULT_PROTEIN_PER_KG,
  GOALS,
  type ActivityLevel,
  type Goal,
  type Sex,
} from "../lib/calories"
import { formatNumber, parseNumberInput } from "../lib/format"
import { ChoiceGroup, NumberField, ResultPanel, ResultRow, SectionLabel, type Choice } from "./fields"

const SEX_OPTIONS: Choice<Sex>[] = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
]

const ACTIVITY_OPTIONS = (Object.keys(ACTIVITY_LEVELS) as ActivityLevel[]).map((value) => ({
  value,
  label: `${ACTIVITY_LEVELS[value].label} · ×${ACTIVITY_LEVELS[value].factor}`,
  hint: ACTIVITY_LEVELS[value].hint,
}))

const GOAL_OPTIONS: Choice<Goal>[] = [
  { value: "lose", label: "Lose" },
  { value: "maintain", label: "Maintain" },
  { value: "gain", label: "Gain" },
]

const MACRO_COLORS = { protein: "bg-chart-1", fat: "bg-chart-2", carbs: "bg-chart-3" } as const
const MACRO_LABELS = { protein: "Protein", fat: "Fat", carbs: "Carbs" } as const

export function CaloriesCalculator() {
  const [sex, setSex] = useState<Sex>("female")
  const [age, setAge] = useState("30")
  const [height, setHeight] = useState("170")
  const [weight, setWeight] = useState("65")
  const [activity, setActivity] = useState<ActivityLevel>("moderate")
  const [goal, setGoal] = useState<Goal>("maintain")
  const [protein, setProtein] = useState(String(DEFAULT_PROTEIN_PER_KG))
  const [fat, setFat] = useState(String(DEFAULT_FAT_PERCENT))

  const res = calculateCalories({
    sex,
    age: parseNumberInput(age),
    heightCm: parseNumberInput(height),
    weightKg: parseNumberInput(weight),
    activity,
    goal,
    proteinPerKg: parseNumberInput(protein),
    fatPercent: parseNumberInput(fat),
  })
  // Don't shout about a field the person is still typing into from scratch.
  const errors = res.ok ? {} : res.errors
  const show = (raw: string, error?: string) => (raw.trim() === "" ? undefined : error)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <form className="grid gap-5" onSubmit={(e) => e.preventDefault()} aria-label="Your details">
        <ChoiceGroup legend="Sex" value={sex} options={SEX_OPTIONS} onChange={setSex} />
        <div className="grid grid-cols-3 gap-3">
          <NumberField label="Age" value={age} onChange={setAge} unit="yrs" error={show(age, errors.age)} />
          <NumberField label="Height" value={height} onChange={setHeight} unit="cm" error={show(height, errors.heightCm)} />
          <NumberField label="Weight" value={weight} onChange={setWeight} unit="kg" error={show(weight, errors.weightKg)} />
        </div>
        <ChoiceGroup legend="Activity" value={activity} options={ACTIVITY_OPTIONS} onChange={setActivity} layout="list" />
        <ChoiceGroup legend="Goal" value={goal} options={GOAL_OPTIONS} onChange={setGoal} />
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Protein"
            value={protein}
            onChange={setProtein}
            unit="g/kg"
            hint="1.6–2.2 suits most active people"
            error={show(protein, errors.proteinPerKg)}
          />
          <NumberField
            label="Fat"
            value={fat}
            onChange={setFat}
            unit="%"
            hint="Share of calories"
            error={show(fat, errors.fatPercent)}
          />
        </div>
      </form>

      <ResultPanel label="Results">
        {res.ok ? (
          <>
            <div className="grid gap-1" role="status">
              <SectionLabel>Daily target</SectionLabel>
              <p className="font-mono text-4xl font-medium tracking-tight tabular sm:text-5xl">
                {formatNumber(res.result.target, 0)}
                <span className="ml-2 text-base font-normal text-muted-foreground">kcal</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {goal === "maintain"
                  ? "to keep your current weight"
                  : `to ${goal === "lose" ? "lose" : "gain"} weight (${GOALS[goal].adjustment > 0 ? "+" : "−"}${Math.abs(GOALS[goal].adjustment * 100)}% of maintenance)`}
              </p>
            </div>

            <dl className="divide-y border-y">
              <ResultRow label="Resting (BMR)" hint="Mifflin–St Jeor" value={formatNumber(res.result.bmr, 0)} unit="kcal" />
              <ResultRow label="Maintenance (TDEE)" hint={`BMR × ${ACTIVITY_LEVELS[activity].factor}`} value={formatNumber(res.result.tdee, 0)} unit="kcal" />
            </dl>

            <section className="grid gap-3" aria-labelledby="macros-heading">
              <SectionLabel id="macros-heading">Macros</SectionLabel>
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                {(["protein", "fat", "carbs"] as const).map((key) => (
                  <div
                    key={key}
                    className={MACRO_COLORS[key]}
                    style={{ width: `${(res.result.macros[key].kcal / res.result.target) * 100}%` }}
                  />
                ))}
              </div>
              <dl className="grid grid-cols-3 gap-3">
                {(["protein", "fat", "carbs"] as const).map((key) => {
                  const m = res.result.macros[key]
                  return (
                    <div key={key} className="grid gap-0.5">
                      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <span className={`size-2 rounded-full ${MACRO_COLORS[key]}`} aria-hidden />
                        {MACRO_LABELS[key]}
                      </dt>
                      <dd className="font-mono tabular">
                        <span className="text-xl font-medium">{formatNumber(m.grams, 0)}</span>
                        <span className="ml-1 text-xs text-muted-foreground">g</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatNumber(m.kcal, 0)} kcal
                          <span className="block">{formatNumber((m.kcal / res.result.target) * 100, 0)}%</span>
                        </span>
                      </dd>
                    </div>
                  )
                })}
              </dl>
            </section>

            {res.result.warnings.length > 0 && (
              <ul className="grid gap-2 text-sm">
                {res.result.warnings.includes("belowBmr") && (
                  <li className="rounded-lg bg-muted px-3 py-2">
                    This target is below your resting needs. Eating that little for long is hard to sustain; consider a
                    smaller deficit or more activity.
                  </li>
                )}
                {res.result.warnings.includes("noRoomForCarbs") && (
                  <li className="rounded-lg bg-muted px-3 py-2">
                    Protein and fat already use up the whole target, so there&apos;s nothing left for carbs. Lower one of
                    them.
                  </li>
                )}
              </ul>
            )}

            <p className="text-xs text-muted-foreground">
              An estimate for healthy adults, typically within ±10% of measured needs. Not medical advice.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground" role="status">
            Fill in age, height and weight to see your numbers.
          </p>
        )}
      </ResultPanel>
    </div>
  )
}
