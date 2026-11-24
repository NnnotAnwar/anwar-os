"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition, type ReactNode } from "react"
import { toast } from "sonner"
import { Archive, ArrowLeft, ChevronLeft, ChevronRight, Pencil, Trash2 } from "@/components/icons"
import { NAV_BACK } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { describeSchedule, shiftMonth, weekdayOf, WEEKDAY_LETTER, WEEKDAY_SHORT } from "../lib/days"
import { formatMonthLabel, formatShortDay } from "../lib/format"
import type { HabitDetail } from "../schema"
import { archiveHabit, deleteHabit } from "../server-actions"
import { StreakBadge, useHabitToggle } from "./habit-check"
import { HabitSheet } from "./habit-form"

export function HabitDetailView({ detail, locale }: { detail: HabitDetail; locale: string }) {
  const router = useRouter()
  const { habit, today } = detail
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, start] = useTransition()

  function archive(archived: boolean) {
    start(async () => {
      const result = await archiveHabit({ id: habit.id, archived })
      if (!result.ok) return void toast.error(result.error)
      if (!archived) return void toast.success(`${habit.name} restored`)
      toast.success(`${habit.name} archived`, {
        description: "Its history is kept.",
        action: { label: "Undo", onClick: () => void archiveHabit({ id: habit.id, archived: false }) },
      })
    })
  }

  function remove() {
    setConfirmDelete(false)
    start(async () => {
      const result = await deleteHabit({ id: habit.id })
      if (!result.ok) return void toast.error(result.error)
      toast.success(`${habit.name} deleted`)
      router.push("/app/habits")
    })
  }

  return (
    <>
      <div className="grid gap-3">
        <Link
          href="/app/habits"
          transitionTypes={NAV_BACK}
          className="text-meta -ml-2 inline-flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-8"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          All habits
        </Link>
        <PageHeader
          eyebrow={habit.archived ? "Archived habit" : "Habit"}
          title={habit.emoji ? `${habit.emoji} ${habit.name}` : habit.name}
          description={`${describeSchedule(habit.weekdays)}${habit.reminderTime ? ` · Telegram reminder at ${habit.reminderTime}` : ""}`}
          actions={
            <>
              <Button variant="outline" onClick={() => setEditing(true)} disabled={pending}>
                <Pencil />
                Edit
              </Button>
              <Button variant="ghost" onClick={() => archive(!habit.archived)} disabled={pending}>
                <Archive />
                {habit.archived ? "Restore" : "Archive"}
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={pending} aria-label="Delete habit">
                <Trash2 />
              </Button>
            </>
          }
        />
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Current streak" value={<StreakBadge value={habit.current} className="text-metric-sm [&_svg]:size-5" />} />
        <Stat label="Best streak" value={habit.best} />
        <Stat label={`${formatMonthLabel(detail.month, locale).split(" ")[0]}`} value={`${detail.monthDone} / ${detail.monthScheduled}`} />
        <Stat label="All time" value={detail.totalDone} />
      </dl>

      <MonthGrid detail={detail} locale={locale} disabled={habit.archived} />

      <HabitSheet open={editing} habit={habit} onClose={() => setEditing(false)} />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {habit.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Its whole history goes too ({detail.totalDone} {detail.totalDone === 1 ? "day" : "days"} done). To keep the history, archive it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* The date the grid treats as today, for tests and screen readers. */}
      <p className="sr-only">Today is {formatShortDay(today, locale)}.</p>
    </>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="glass grid gap-1 rounded-xl p-4">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-metric-sm tabular-nums">{value}</dd>
    </div>
  )
}

function MonthGrid({ detail, locale, disabled }: { detail: HabitDetail; locale: string; disabled: boolean }) {
  const { habit, month, days, today } = detail
  const { stateOf, toggle } = useHabitToggle()
  const lead = weekdayOf(days[0]!.day)
  const prev = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)
  const hasNext = next <= today.slice(0, 7)

  return (
    <section className="glass grid gap-3 rounded-xl p-4" aria-label={`${formatMonthLabel(month, locale)}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-card-title">{formatMonthLabel(month, locale)}</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon-lg" render={<Link href={`?month=${prev}`} scroll={false} />} nativeButton={false} aria-label="Previous month">
            <ChevronLeft />
          </Button>
          {hasNext ? (
            <Button variant="ghost" size="icon-lg" render={<Link href={`?month=${next}`} scroll={false} />} nativeButton={false} aria-label="Next month">
              <ChevronRight />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-lg" disabled aria-label="Next month">
              <ChevronRight />
            </Button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center sm:max-w-md">
        {WEEKDAY_LETTER.map((letter, i) => (
          <span key={i} title={WEEKDAY_SHORT[i]} aria-hidden className="text-micro py-1 text-muted-foreground">
            {letter}
          </span>
        ))}
        <ul className="contents" aria-label="Days">
          {Array.from({ length: lead }, (_, i) => (
            <li key={`lead-${i}`} aria-hidden />
          ))}
          {days.map((d) => {
            const state = stateOf({ id: habit.id, done: d.done, current: 0 }, d.day)
            const isToday = d.day === today
            return (
              <li key={d.day} className="flex justify-center">
                <button
                  type="button"
                  aria-pressed={state.done}
                  aria-current={isToday ? "date" : undefined}
                  aria-label={`${formatShortDay(d.day, locale)}${d.scheduled ? "" : " (not scheduled)"}`}
                  disabled={d.future || disabled}
                  onClick={() => toggle({ id: habit.id, name: habit.name, done: d.done, current: 0 }, d.day)}
                  className={cn(
                    "text-small flex size-11 items-center justify-center rounded-lg tabular-nums outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-12",
                    state.done
                      ? "animate-pop bg-primary text-primary-foreground"
                      : d.scheduled
                        ? "border border-field-border bg-field hover:border-accent-500"
                        : "text-muted-foreground/70 hover:bg-accent-500/10",
                    isToday && !state.done && "ring-2 ring-accent-500/60",
                    d.future && "opacity-40",
                  )}
                >
                  {Number(d.day.slice(8))}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <p className="text-caption text-muted-foreground">
        Tap a day to mark it done or not. Faint days aren&apos;t on the schedule: they don&apos;t count for the streak.
      </p>
    </section>
  )
}
