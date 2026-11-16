"use client"

import { Flag, Gift, MapPin, Repeat } from "@/components/icons"
import { cn } from "@/lib/utils"
import { categoryInfo } from "../lib/categories"
import { formatClock, formatDuration } from "../lib/format"
import type { Occurrence } from "../schema"

export function CategoryDot({ category, className }: { category: Occurrence["category"]; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", categoryInfo[category].dot, className)} />
}

/** Time column text for a day: "All day", "09:00 – 10:30", or "until 11:00" for a spill-over. */
export function timeLabel(o: Occurrence, day: string, timeZone: string) {
  if (o.allDay) return "All day"
  const start = new Date(o.start)
  const end = new Date(o.end)
  const startDay = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(start)
  const endDay = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(end.getTime() - 1))
  if (startDay < day && endDay > day) return "All day"
  if (startDay < day) return `until ${formatClock(end, timeZone)}`
  if (endDay > day) return `from ${formatClock(start, timeZone)}`
  return start.getTime() === end.getTime() ? formatClock(start, timeZone) : `${formatClock(start, timeZone)} – ${formatClock(end, timeZone)}`
}

/** One agenda / day-panel row: time, title, meta line, all one button. */
export function EventRow({
  o,
  day,
  timeZone,
  past,
  onOpen,
}: {
  o: Occurrence
  day: string
  timeZone: string
  past?: boolean
  onOpen: (eventId: string) => void
}) {
  const info = categoryInfo[o.category]
  const Icon = o.category === "birthday" ? Gift : o.category === "deadline" ? Flag : null
  const duration = !o.allDay ? formatDuration(new Date(o.end).getTime() - new Date(o.start).getTime()) : null
  return (
    <button
      type="button"
      onClick={() => onOpen(o.eventId)}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-white/40 focus-visible:ring-3 focus-visible:ring-ring/50 dark:hover:bg-white/5",
        past && "opacity-60",
      )}
    >
      <span className="text-small w-[5.75rem] shrink-0 pt-px text-muted-foreground tabular-nums">{timeLabel(o, day, timeZone)}</span>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-body flex items-center gap-1.5">
          <CategoryDot category={o.category} />
          <span className="truncate">{o.title}</span>
          {Icon && <Icon className="size-3.5 shrink-0 text-text-accent" aria-label={info.label} />}
        </span>
        <span className="text-caption flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span>{info.label}</span>
          {duration && duration !== "0m" && <span className="tabular-nums">· {duration}</span>}
          {o.recurring && <Repeat className="size-3 shrink-0" aria-label="Repeats" />}
          {o.location && (
            <span className="flex min-w-0 items-center gap-0.5">
              · <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{o.location}</span>
            </span>
          )}
        </span>
      </span>
    </button>
  )
}
