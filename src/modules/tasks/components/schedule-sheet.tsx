"use client"

import { useState } from "react"
import { CalendarDays, CalendarX, Couch, SunHorizon, ArrowBendUpRight } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addDays, formatIsoDate, parseIsoDate, weekdayOf } from "@/modules/calendar/lib/zoned"
import { dueLabel } from "../lib/format"
import type { Task } from "../schema"

/** The quick dates every scheduler offers, relative to the viewer's today. */
export function quickDates(todayIso: string) {
  const today = parseIsoDate(todayIso)!
  const wd = weekdayOf(today)
  const saturday = addDays(today, wd >= 6 ? 0 : 6 - wd)
  const monday = addDays(today, 8 - wd)
  return [
    { key: "today", label: "Today", date: todayIso, icon: SunHorizon },
    { key: "tomorrow", label: "Tomorrow", date: formatIsoDate(addDays(today, 1)), icon: ArrowBendUpRight },
    { key: "weekend", label: wd >= 6 ? "This weekend" : "Weekend", date: formatIsoDate(saturday), icon: Couch },
    { key: "next-week", label: "Next week", date: formatIsoDate(monday), icon: CalendarDays },
  ]
}

/** Swipe left (or "Schedule") on a task: one tap picks a date. */
export function ScheduleOptions({
  task,
  today,
  locale,
  onPick,
}: {
  task: Pick<Task, "dueDate" | "title">
  today: string
  locale: string
  onPick: (dueDate: string | null) => void
}) {
  const [custom, setCustom] = useState(task.dueDate ?? today)
  return (
    <div className="grid gap-1 p-2">
      {quickDates(today).map((q) => (
        <button
          key={q.key}
          type="button"
          onClick={() => onPick(q.date)}
          aria-current={task.dueDate === q.date ? "true" : undefined}
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-left outline-none hover:bg-track focus-visible:bg-track focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current]:text-text-accent"
        >
          <q.icon className="size-4 text-muted-foreground" />
          <span className="text-body flex-1">{q.label}</span>
          <span className="text-caption text-muted-foreground tabular-nums">{dueLabel(q.date, today, locale).text}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onPick(null)}
        className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-left outline-none hover:bg-track focus-visible:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CalendarX className="size-4 text-muted-foreground" />
        <span className="text-body flex-1">No date</span>
      </button>
      <form
        className="mt-1 flex items-center gap-2 border-t border-hairline px-1 pt-3 pb-1"
        onSubmit={(e) => {
          e.preventDefault()
          if (parseIsoDate(custom)) onPick(custom)
        }}
      >
        <label htmlFor="schedule-date" className="sr-only">
          Pick a date
        </label>
        <Input
          id="schedule-date"
          type="date"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-10 flex-1 dark:[color-scheme:dark]"
        />
        <Button type="submit" size="lg" className="h-10">
          Set date
        </Button>
      </form>
    </div>
  )
}
