"use client"

import { cn } from "@/lib/utils"
import { formatDayMonth, formatWeekdayShort } from "../lib/format"
import { addDays, formatIsoDate, utcMidnight, type LocalDate } from "../lib/zoned"
import type { Occurrence } from "../schema"
import { EventRow } from "./event-row"

/**
 * Upcoming days that have something on them: date column ("16 Nov" with the
 * weekday as a micro line), then rows. Today shows a "now" line between what
 * has passed and what is next.
 */
export function AgendaView({
  from,
  days,
  today,
  now,
  byDay,
  timeZone,
  locale,
  onOpen,
}: {
  from: LocalDate
  days: number
  today: LocalDate
  now: Date
  byDay: Map<string, Occurrence[]>
  timeZone: string
  locale: string
  onOpen: (eventId: string) => void
}) {
  const todayIso = formatIsoDate(today)
  const list = Array.from({ length: days }, (_, i) => addDays(from, i))
    .map((d) => ({ date: d, iso: formatIsoDate(d), events: byDay.get(formatIsoDate(d)) ?? [] }))
    .filter((d) => d.events.length > 0 || d.iso === todayIso)

  if (list.length === 0) {
    return (
      <div className="glass rounded-xl p-6">
        <p className="text-body-strong">Nothing planned</p>
        <p className="text-meta text-muted-foreground">The next {days} days are free. Add something with quick add above.</p>
      </div>
    )
  }

  return (
    <ol className="glass divide-y divide-hairline overflow-hidden rounded-xl">
      {list.map(({ date, iso, events }) => {
        const isToday = iso === todayIso
        const label = utcMidnight(date)
        const nowIndex = isToday ? events.findIndex((o) => !o.allDay && new Date(o.start) > now) : -1
        const insertAt = isToday ? (nowIndex === -1 ? events.length : nowIndex) : -1
        return (
          <li key={iso} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 px-2 py-2 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:px-3">
            <div className="grid content-start justify-items-start gap-1 pt-2">
              <span className={cn("text-micro", isToday ? "text-text-accent" : "text-muted-foreground")}>
                {isToday ? "Today" : formatWeekdayShort(label, locale, "UTC")}
              </span>
              <span className="text-body-strong tabular-nums">{formatDayMonth(label, locale, "UTC")}</span>
            </div>
            <ul className="grid gap-0.5">
              {events.map((o, i) => (
                <li key={o.key}>
                  {i === insertAt && <NowLine />}
                  <EventRow o={o} day={iso} timeZone={timeZone} past={isToday && !o.allDay && new Date(o.end) < now} onOpen={onOpen} />
                </li>
              ))}
              {insertAt === events.length && (
                <li>
                  <NowLine />
                  {events.length === 0 && <p className="text-meta px-2 py-2 text-muted-foreground">Nothing planned today.</p>}
                </li>
              )}
            </ul>
          </li>
        )
      })}
    </ol>
  )
}

/** The accent "now" marker (Planuj Glass: now is the accent). */
export function NowLine() {
  return (
    <div className="relative mx-2 my-1 h-0.5 rounded-full bg-accent-500" role="separator" aria-label="Now">
      <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-accent-500" />
    </div>
  )
}
