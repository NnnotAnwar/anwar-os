import Link from "next/link"
import { Flag, Gift } from "@/components/icons"
import type { ViewerContext } from "@/core/module"
import { actions } from "../actions"
import { categoryInfo } from "../lib/categories"
import { groupByDay } from "../lib/days"
import { dateLocale, formatClock, formatDayMonth, formatWeekdayShort } from "../lib/format"
import { calendarHref } from "../lib/links"
import { addDays, formatIsoDate, startOfLocalDay, utcMidnight, wallClock } from "../lib/zoned"

const DAYS = 8

/** Today and the next 7 days, grouped by day; important dates are flagged. */
export async function Upcoming({ ctx }: { ctx: ViewerContext }) {
  const now = new Date()
  const w = wallClock(now, ctx.timezone)
  const today = { year: w.year, month: w.month, day: w.day }
  const occurrences = await actions.range.handler({
    from: startOfLocalDay(today, ctx.timezone),
    to: startOfLocalDay(addDays(today, DAYS), ctx.timezone),
  })
  const byDay = groupByDay(occurrences, ctx.timezone)
  const locale = dateLocale(ctx.locale)
  const days = Array.from({ length: DAYS }, (_, i) => addDays(today, i))
    .map((d) => ({ date: d, iso: formatIsoDate(d), events: byDay.get(formatIsoDate(d)) ?? [] }))
    .filter((d, i) => i === 0 || d.events.length > 0)

  if (occurrences.length === 0) {
    return (
      <p className="text-meta text-muted-foreground">
        A free week.{" "}
        <Link href={calendarHref({ create: true })} className="text-text-accent underline-offset-4 hover:underline">
          Add an event
        </Link>
      </p>
    )
  }

  return (
    <ol className="grid gap-2">
      {days.map(({ date, iso, events }, i) => (
        <li key={iso} className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-2">
          <Link href={calendarHref({ date })} className="grid content-start rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <span className={i === 0 ? "text-micro text-text-accent" : "text-micro text-muted-foreground"}>
              {i === 0 ? "Today" : formatWeekdayShort(utcMidnight(date), locale, "UTC")}
            </span>
            <span className="text-small tabular-nums">{formatDayMonth(utcMidnight(date), locale, "UTC")}</span>
          </Link>
          {events.length === 0 ? (
            <p className="text-meta pt-2 text-muted-foreground">Nothing today.</p>
          ) : (
            <ul className="grid gap-0.5">
              {events.slice(0, 4).map((o) => {
                const Icon = o.category === "birthday" ? Gift : o.category === "deadline" ? Flag : null
                const past = !o.allDay && new Date(o.end) < now
                return (
                  <li key={o.key}>
                    <Link
                      href={calendarHref({ date, event: o.eventId })}
                      className={`-mx-1 flex items-baseline gap-2 rounded-md px-1 py-0.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 ${past ? "opacity-60" : ""}`}
                    >
                      <span className="text-caption w-10 shrink-0 text-muted-foreground tabular-nums">
                        {o.allDay ? "All day" : formatClock(new Date(o.start), ctx.timezone)}
                      </span>
                      <span className="text-body min-w-0 flex-1 truncate">{o.title}</span>
                      {Icon && <Icon className="size-3.5 shrink-0 self-center text-text-accent" aria-label={categoryInfo[o.category].label} />}
                    </Link>
                  </li>
                )
              })}
              {events.length > 4 && <li className="text-caption text-muted-foreground tabular-nums">+{events.length - 4} more</li>}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}
