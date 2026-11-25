"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowUpRight, Plus } from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { Field, fieldClass, SaveStatus, Toggle } from "@/components/editor-fields"
import { buttonVariants } from "@/components/ui/button"
import { useAutosave } from "@/lib/use-autosave"
import { cn } from "@/lib/utils"
import { setGoalOnNow } from "@/modules/goals/server-actions"
import type { GoalStatus } from "@/modules/goals/schema"
import { NOW_INTRO_MAX, NOW_LOCATION_MAX, type NowSettings, type NowSettingsInput } from "../schema"
import { saveNowSettings } from "../server-actions"

type GoalRow = { id: string; title: string; status: GoalStatus; showOnNow: boolean }

/**
 * The owner's controls for /now: the words (autosaved like every editor), the
 * section switches (same save), and which of this year's goals are listed
 * (each switch applies at once, like the one in the goal editor).
 */
export function NowSettingsForm({
  settings,
  goals,
  year,
  cvLocation,
  timezone,
  locale,
}: {
  settings: NowSettings
  goals: GoalRow[]
  year: number
  cvLocation: string
  timezone: string
  locale: string
}) {
  const initial: NowSettingsInput = {
    intro: settings.intro,
    location: settings.location,
    showGoals: settings.showGoals,
    showProjects: settings.showProjects,
    showWriting: settings.showWriting,
    showHabits: settings.showHabits,
  }
  const { value, update, status } = useAutosave<NowSettingsInput>({
    initial,
    initialSavedAt: settings.updatedAt,
    shortcut: true,
    save: (v) => saveNowSettings(v),
  })

  return (
    <div className="grid gap-4">
      <div className="flex min-h-9 items-center gap-2">
        <SaveStatus status={status} timezone={timezone} locale={locale} className="min-w-0 flex-1" />
        <a
          href="/now"
          target="_blank"
          rel="noreferrer"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-11")}
        >
          Open /now
          <ArrowUpRight className="size-3.5 opacity-70" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>

      <section aria-labelledby="now-words" className="glass grid gap-4 rounded-xl p-4 md:p-6">
        <h2 id="now-words" className="text-card-title">
          In your words
        </h2>
        <Field label="Intro" hint="A line or two at the top of the page: what has your attention these weeks.">
          {(id) => (
            <textarea
              id={id}
              value={value.intro}
              onChange={(e) => update({ intro: e.target.value })}
              maxLength={NOW_INTRO_MAX}
              rows={3}
              placeholder="e.g. Finishing my economics degree and shipping Shiftella to its first cafés."
              className={cn(fieldClass, "field-sizing-content h-auto min-h-20 resize-none py-2 leading-6")}
            />
          )}
        </Field>
        <Field
          label="Based in"
          hint={
            cvLocation
              ? `Leave empty to use your CV's location (${cvLocation}).`
              : "Shown as “Based in …”. Leave empty to leave it out."
          }
        >
          {(id) => (
            <input
              id={id}
              value={value.location}
              onChange={(e) => update({ location: e.target.value })}
              maxLength={NOW_LOCATION_MAX}
              placeholder={cvLocation || "Prague, Czech Republic"}
              autoComplete="off"
              className={fieldClass}
            />
          )}
        </Field>
      </section>

      <section aria-labelledby="now-sections" className="glass grid gap-4 rounded-xl p-4 md:p-6">
        <div className="grid gap-1">
          <h2 id="now-sections" className="text-card-title">
            Sections
          </h2>
          <p className="text-caption text-muted-foreground">Each one fills itself from your data. Empty ones stay hidden.</p>
        </div>
        <Toggle
          checked={value.showGoals}
          onChange={(v) => update({ showGoals: v })}
          label="Current focus"
          description={`This year's goals you marked “Show on /now”, with their progress.`}
        />
        <Toggle
          checked={value.showProjects}
          onChange={(v) => update({ showProjects: v })}
          label="Projects"
          description="Public projects you're building, then your featured ones."
        />
        <Toggle
          checked={value.showWriting}
          onChange={(v) => update({ showWriting: v })}
          label="Latest writing"
          description="Your three newest published notes."
        />
        <Toggle
          checked={value.showHabits}
          onChange={(v) => update({ showHabits: v })}
          label="Habits"
          description="One line: how many habits you keep and your longest current streak. Never their names."
        />
      </section>

      <GoalsCard goals={goals} year={year} sectionOn={value.showGoals} />
    </div>
  )
}

function GoalsCard({ goals, year, sectionOn }: { goals: GoalRow[]; year: number; sectionOn: boolean }) {
  const [shown, setShown] = useState(() => new Map(goals.map((g) => [g.id, g.showOnNow])))
  const [pending, startTransition] = useTransition()
  const count = [...shown.values()].filter(Boolean).length

  function change(goal: GoalRow, next: boolean) {
    setShown((m) => new Map(m).set(goal.id, next))
    startTransition(async () => {
      const result = await setGoalOnNow({ id: goal.id, value: next })
      if (!result.ok) {
        setShown((m) => new Map(m).set(goal.id, !next))
        toast.error(result.error)
      }
    })
  }

  return (
    <section aria-labelledby="now-goals" className="glass grid gap-4 rounded-xl p-4 md:p-6">
      <div className="grid gap-1">
        <h2 id="now-goals" className="text-card-title">
          Goals on /now <span className="text-meta text-muted-foreground tabular-nums">{year}</span>
        </h2>
        <p className="text-caption text-muted-foreground">
          Goals are private until you switch them on here or in the goal itself. Visitors see the title and progress,
          never the why.
          {!sectionOn && count > 0 && " The Current focus section is off, so none show right now."}
        </p>
      </div>
      {goals.length === 0 ? (
        <div className="grid justify-items-start gap-2">
          <p className="text-meta text-muted-foreground">No goals for {year} yet.</p>
          <Link
            href="/app/goals/new"
            transitionTypes={NAV_FORWARD}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-11")}
          >
            <Plus />
            New goal
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {goals.map((g) => (
            <li key={g.id}>
              <Toggle
                checked={shown.get(g.id) ?? false}
                onChange={(v) => change(g, v)}
                disabled={pending}
                label={g.title}
                description={g.status === "done" ? "Achieved" : undefined}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
