import type { CSSProperties } from "react"
import { cn } from "@/lib/utils"
import {
  daysLeftInYear,
  isoWeek,
  isoWeekRange,
  isoWeeksInYear,
  type CalendarDate,
} from "@/lib/time"

/**
 * The year as a ruler of ISO weeks. Past weeks are inked, the current week carries
 * the sun marker, future weeks are faint. Month starts get taller ticks.
 */
export function YearRuler({ today, locale }: { today: CalendarDate; locale: string }) {
  const { week: currentWeek, weekYear } = isoWeek(today)
  const total = isoWeeksInYear(weekYear)
  const daysLeft = daysLeftInYear(today)

  const monthFormat = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" })
  const dayFormat = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" })

  // The ISO week each month starts in (Jan 1 can belong to last year's final week).
  const monthStarts = Array.from({ length: 12 }, (_, i) => {
    const w = isoWeek({ year: weekYear, month: i + 1, day: 1 })
    return { week: w.weekYear === weekYear ? w.week : 1, label: monthFormat.format(new Date(Date.UTC(weekYear, i, 1))) }
  })
  const monthStartWeeks = new Set(monthStarts.map((m) => m.week))

  const summary = `Week ${currentWeek} of ${total} · ${daysLeft} ${daysLeft === 1 ? "day" : "days"} left in ${today.year}`

  return (
    <figure className="grid gap-2" aria-label={summary}>
      <div className="flex h-12 items-end justify-between" aria-hidden>
        {Array.from({ length: total }, (_, i) => {
          const week = i + 1
          const { start, end } = isoWeekRange(weekYear, week)
          const isNow = week === currentWeek
          const isPast = week < currentWeek
          return (
            <span
              key={week}
              title={`Week ${week} · ${dayFormat.format(start)} – ${dayFormat.format(end)}`}
              style={{ "--i": i } as CSSProperties}
              className={cn(
                "ruler-tick relative w-px rounded-full",
                monthStartWeeks.has(week) ? "h-6" : "h-3.5",
                isPast ? "bg-foreground/75" : "bg-mist/25",
                isNow && "h-9 w-[3px] bg-sun",
              )}
            >
              {isNow && (
                <span className="ruler-sun absolute -top-3 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-sun ring-4 ring-sun/20" />
              )}
            </span>
          )
        })}
      </div>
      <div className="relative h-4 font-mono text-[10px] tracking-wider text-muted-foreground uppercase" aria-hidden>
        {monthStarts.map((m, i) => (
          <span
            key={m.label}
            className={cn("absolute", i % 2 === 1 && "max-sm:hidden")}
            style={{ left: `${((m.week - 1) / (total - 1)) * 100}%` }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <figcaption className="font-mono text-xs text-muted-foreground tabular">{summary}</figcaption>
    </figure>
  )
}
