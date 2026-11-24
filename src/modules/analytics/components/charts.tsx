import { cn } from "@/lib/utils"
import type { DailyViews } from "../schema"

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" })
const weekdayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })

export const formatDay = (day: string) => dayFormat.format(new Date(`${day}T00:00:00Z`))
const formatDayLong = (day: string) => weekdayFormat.format(new Date(`${day}T00:00:00Z`))

/**
 * Views per day as bars, today on the right. One series in the accent, bars
 * anchored to the baseline with rounded tops, a 2px gap between them; every bar
 * shows its day and count on hover and to screen readers (the hidden table).
 */
export function DailyBars({
  daily,
  height = "h-40",
  axis = true,
  className,
}: {
  daily: DailyViews[]
  height?: string
  axis?: boolean
  className?: string
}) {
  const max = Math.max(1, ...daily.map((d) => d.views))
  const total = daily.reduce((sum, d) => sum + d.views, 0)
  return (
    <figure className={cn("grid gap-1.5", className)}>
      <div className="relative">
        {axis && (
          <span className="text-caption pointer-events-none absolute top-0 right-0 text-muted-foreground tabular-nums">
            {max}
          </span>
        )}
        <div
          className={cn("flex items-end gap-[2px] border-b border-hairline", height, axis && "pr-8")}
          aria-hidden
        >
          {daily.map((d) => (
            <span key={d.day} className="group relative flex h-full flex-1 items-end" title={`${formatDayLong(d.day)}: ${d.views} ${d.views === 1 ? "view" : "views"}`}>
              <span
                className={cn(
                  "w-full rounded-t-[4px] transition-colors",
                  d.views ? "bg-accent-500/80 group-hover:bg-accent-600" : "bg-track",
                )}
                style={{ height: d.views ? `${Math.max(4, (d.views / max) * 100)}%` : "2px" }}
              />
            </span>
          ))}
        </div>
      </div>
      {axis && daily.length > 0 && (
        <figcaption className="text-caption flex justify-between pr-8 text-muted-foreground tabular-nums">
          <span>{formatDay(daily[0]!.day)}</span>
          <span>Today (UTC)</span>
        </figcaption>
      )}
      <table className="sr-only">
        <caption>
          Views per day, {total} in total
        </caption>
        <tbody>
          {daily.map((d) => (
            <tr key={d.day}>
              <th scope="row">{formatDayLong(d.day)}</th>
              <td>{d.views}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}

/** A ranked list with a proportional bar behind each row: label left, count right. */
export function RankedList({
  rows,
  empty,
}: {
  rows: { key: string; label: string; views: number; href?: string }[]
  empty: string
}) {
  if (rows.length === 0) return <p className="text-meta text-muted-foreground">{empty}</p>
  const max = Math.max(1, ...rows.map((r) => r.views))
  return (
    <ol className="grid gap-1">
      {rows.map((row) => (
        <li key={row.key} className="relative flex min-h-9 items-center gap-3 overflow-hidden rounded-lg px-2.5">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-lg bg-accent-500/12"
            style={{ width: `${(row.views / max) * 100}%` }}
          />
          <span className="text-body relative min-w-0 flex-1 truncate">
            {row.href ? (
              <a href={row.href} target="_blank" rel="noreferrer" className="outline-none hover:text-text-accent hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                {row.label}
              </a>
            ) : (
              row.label
            )}
          </span>
          <span className="text-body-strong relative tabular-nums">{row.views.toLocaleString("en")}</span>
        </li>
      ))}
    </ol>
  )
}
