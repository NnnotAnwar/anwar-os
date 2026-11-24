"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { fieldClass, Toggle } from "@/components/editor-fields"
import { Plant, Plus, TelegramLogo } from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { describeSchedule } from "../lib/days"
import type { Habit, HabitsOverview, HabitsSettings, HabitSummary } from "../schema"
import { archiveHabit, updateHabitsSettings } from "../server-actions"
import { DayStrip } from "./day-strip"
import { HabitCheck, StreakBadge, useHabitToggle } from "./habit-check"
import { HabitSheet } from "./habit-form"

export function HabitsBoard({
  data,
  settings,
  todayLabel,
  openNew,
  showArchived,
}: {
  data: HabitsOverview
  settings: HabitsSettings
  todayLabel: string
  openNew: boolean
  showArchived: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [editing, setEditing] = useState<{ habit: Habit | null } | null>(openNew ? { habit: null } : null)
  const { stateOf, toggle } = useHabitToggle()

  const scheduled = data.habits.filter((h) => h.scheduledToday)
  const doneToday = scheduled.filter((h) => stateOf({ id: h.id, done: h.doneToday, current: h.current }).done).length

  function close() {
    setEditing(null)
    // Drop ?new=1 so a reload doesn't open the sheet again.
    if (openNew) router.replace(pathname, { scroll: false })
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => setEditing({ habit: null })}>
          <Plus />
          New habit
        </Button>
        {scheduled.length > 0 && (
          <p className="text-meta text-muted-foreground tabular-nums" aria-live="polite">
            {todayLabel} · {doneToday === scheduled.length ? "all done" : `${doneToday} of ${scheduled.length} done`}
          </p>
        )}
      </div>

      {data.habits.length === 0 ? (
        <div className="glass grid justify-items-start gap-2 rounded-xl p-6">
          <span className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground [&_svg]:size-5">
            <Plant />
          </span>
          <p className="text-card-title">No habits yet</p>
          <p className="text-meta max-w-prose text-muted-foreground">
            Pick something small you want to do on certain days: read 20 minutes, stretch, no sugar. Tick it off here, on Today or in Telegram,
            and watch the streak grow.
          </p>
          <Button className="mt-1" onClick={() => setEditing({ habit: null })}>
            <Plus />
            Add your first habit
          </Button>
        </div>
      ) : (
        <ul className="glass grid gap-px overflow-hidden rounded-xl" aria-label="Habits">
          {data.habits.map((habit) => (
            <HabitRow
              key={habit.id}
              habit={habit}
              state={stateOf({ id: habit.id, done: habit.doneToday, current: habit.current })}
              onToggle={() => toggle({ id: habit.id, name: habit.name, done: habit.doneToday, current: habit.current })}
            />
          ))}
        </ul>
      )}

      <NudgeSettings settings={settings} />

      {data.archived.length > 0 && <ArchivedList habits={data.archived} open={showArchived} />}

      <HabitSheet open={editing !== null} habit={editing?.habit ?? null} onClose={close} />
    </div>
  )
}

function HabitRow({ habit, state, onToggle }: { habit: HabitSummary; state: { done: boolean; current: number }; onToggle: () => void }) {
  return (
    <li className="flex items-start gap-3 bg-card/40 px-4 py-3">
      <div className="pt-0.5">
        {habit.scheduledToday ? (
          <HabitCheck checked={state.done} onToggle={onToggle} label={`Done today: ${habit.name}`} />
        ) : (
          <span className="-m-2 flex size-11 items-center justify-center" title="Not scheduled today">
            <span className="size-6 rounded-full border-[1.5px] border-dashed border-muted-foreground/30" aria-hidden />
            <span className="sr-only">Not scheduled today</span>
          </span>
        )}
      </div>
      <div className="grid min-w-0 flex-1 gap-1.5">
        <div className="flex items-baseline gap-2">
          <Link
            href={`/app/habits/${habit.id}`}
            transitionTypes={NAV_FORWARD}
            className="text-body-strong flex min-w-0 flex-1 items-baseline gap-1.5 rounded outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {habit.emoji && <span aria-hidden>{habit.emoji}</span>}
            <span className="truncate">{habit.name}</span>
          </Link>
          <StreakBadge value={state.current} />
        </div>
        <p className="text-caption text-muted-foreground">
          {describeSchedule(habit.weekdays)}
          {habit.reminderTime && ` · reminder ${habit.reminderTime}`}
          {habit.best > 0 && ` · best ${habit.best}`}
        </p>
        <DayStrip days={habit.recent} className="max-w-sm" />
      </div>
    </li>
  )
}

function NudgeSettings({ settings }: { settings: HabitsSettings }) {
  const [enabled, setEnabled] = useState(settings.nudgeEnabled)
  const [time, setTime] = useState(settings.nudgeTime)
  const [, start] = useTransition()

  function save(next: HabitsSettings) {
    start(async () => {
      const result = await updateHabitsSettings(next)
      if (!result.ok) {
        setEnabled(settings.nudgeEnabled)
        setTime(settings.nudgeTime)
        toast.error(result.error)
        return
      }
      toast.success(next.nudgeEnabled ? `Evening nudge at ${next.nudgeTime}` : "Evening nudge off")
    })
  }

  return (
    <section className="glass grid gap-3 rounded-xl p-4" aria-labelledby="habits-nudge">
      <h2 id="habits-nudge" className="text-card-title flex items-center gap-2 [&_svg]:size-4">
        <TelegramLogo />
        Evening nudge
      </h2>
      <Toggle
        checked={enabled}
        onChange={(on) => {
          setEnabled(on)
          save({ nudgeEnabled: on, nudgeTime: time })
        }}
        label="Remind me in Telegram about habits still open"
        description="osbot sends one message with buttons to tick them off. Nothing is sent when everything is done."
      />
      <label className={cn("flex items-center gap-3", !enabled && "opacity-60")}>
        <span className="text-small text-muted-foreground">At</span>
        <input
          type="time"
          value={time}
          disabled={!enabled}
          onChange={(e) => setTime(e.target.value)}
          onBlur={() => enabled && time && time !== settings.nudgeTime && save({ nudgeEnabled: true, nudgeTime: time })}
          aria-label="Evening nudge time"
          className={cn(fieldClass, "w-32 tabular-nums dark:[color-scheme:dark]")}
        />
      </label>
    </section>
  )
}

function ArchivedList({ habits, open }: { habits: Habit[]; open: boolean }) {
  const [pending, start] = useTransition()
  return (
    <details open={open} className="glass group rounded-xl">
      <summary className="text-body-strong flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        Archived
        <span className="text-caption text-muted-foreground tabular-nums">{habits.length}</span>
      </summary>
      <ul className="grid gap-px border-t border-border/60">
        {habits.map((habit) => (
          <li key={habit.id} className="flex items-center gap-3 px-4 py-2">
            <Link href={`/app/habits/${habit.id}`} className="text-body min-w-0 flex-1 truncate rounded outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
              {habit.emoji && <span aria-hidden>{habit.emoji} </span>}
              {habit.name}
            </Link>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const result = await archiveHabit({ id: habit.id, archived: false })
                  if (result.ok) toast.success(`${habit.name} restored`)
                  else toast.error(result.error)
                })
              }
            >
              Restore
            </Button>
          </li>
        ))}
      </ul>
    </details>
  )
}
