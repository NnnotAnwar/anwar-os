"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import { minutesIntoDay, sameDay, startOfWeek } from "../lib/days"
import { formatClock } from "../lib/format"
import { addDays, formatIsoDate, wallClock, type LocalDate } from "../lib/zoned"
import type { Occurrence } from "../schema"
import { CategoryDot } from "./event-row"

const HOUR_PX = 44
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

type Placed = { o: Occurrence; top: number; height: number; lane: number; lanes: number }

/** Timed events of one day, laid out in side-by-side lanes where they overlap. */
function layoutDay(events: Occurrence[], day: LocalDate, timeZone: string): Placed[] {
  const items = events
    .filter((o) => !o.allDay)
    .map((o) => {
      const startMin = minutesIntoDay(new Date(o.start), day, timeZone)
      const endMin = Math.max(minutesIntoDay(new Date(o.end), day, timeZone), startMin + 20)
      return { o, startMin, endMin }
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)

  const placed: Placed[] = []
  let cluster: (typeof items[number] & { lane: number })[] = []
  let clusterEnd = -1
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1))
    for (const c of cluster) {
      placed.push({ o: c.o, top: (c.startMin / 60) * HOUR_PX, height: ((c.endMin - c.startMin) / 60) * HOUR_PX, lane: c.lane, lanes })
    }
    cluster = []
  }
  for (const item of items) {
    if (item.startMin >= clusterEnd && cluster.length) flush()
    const used = new Set(cluster.filter((c) => c.endMin > item.startMin).map((c) => c.lane))
    let lane = 0
    while (used.has(lane)) lane++
    cluster.push({ ...item, lane })
    clusterEnd = Math.max(clusterEnd, item.endMin)
  }
  if (cluster.length) flush()
  return placed
}

export function WeekView({
  anchor,
  today,
  now,
  byDay,
  timeZone,
  onSelectDay,
  onOpen,
  onAdd,
}: {
  anchor: LocalDate
  today: LocalDate
  now: Date
  byDay: Map<string, Occurrence[]>
  timeZone: string
  onSelectDay: (date: LocalDate) => void
  onOpen: (eventId: string) => void
  onAdd: (date: LocalDate, hour: number) => void
}) {
  const monday = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const scroller = useRef<HTMLDivElement>(null)
  const nowWall = wallClock(now, timeZone)
  const nowTop = ((nowWall.hour * 60 + nowWall.minute) / 60) * HOUR_PX
  const showsToday = days.some((d) => sameDay(d, today))

  // Open scrolled to just before now (or 07:00 on other weeks).
  useEffect(() => {
    const target = showsToday ? Math.max(0, nowTop - 2 * HOUR_PX) : 7 * HOUR_PX
    scroller.current?.scrollTo({ top: target })
  }, [showsToday, nowTop])

  const allDay = days.map((d) => (byDay.get(formatIsoDate(d)) ?? []).filter((o) => o.allDay))
  const hasAllDay = allDay.some((l) => l.length > 0)

  return (
    <div className="glass overflow-hidden rounded-xl">
      <div className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] border-b border-hairline">
        <span />
        {days.map((d, i) => {
          const isToday = sameDay(d, today)
          return (
            <button
              key={formatIsoDate(d)}
              type="button"
              onClick={() => onSelectDay(d)}
              className="grid justify-items-center gap-1 py-2 outline-none hover:bg-white/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset dark:hover:bg-white/5"
              aria-label={`Open ${formatIsoDate(d)} in the month view`}
            >
              <span className="text-micro text-muted-foreground">{WEEKDAYS[i]}</span>
              <span
                className={cn(
                  "text-small flex size-6 items-center justify-center rounded-full tabular-nums",
                  isToday && "bg-accent-500 font-semibold text-white",
                )}
              >
                {d.day}
              </span>
            </button>
          )
        })}
      </div>
      {hasAllDay && (
        <div className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] border-b border-hairline">
          <span className="text-micro self-center pl-1 text-muted-foreground">All day</span>
          {allDay.map((list, i) => (
            <ul key={i} className="grid content-start gap-0.5 border-l border-hairline p-0.5">
              {list.map((o) => (
                <li key={o.key}>
                  <button
                    type="button"
                    onClick={() => onOpen(o.eventId)}
                    className="text-caption flex w-full items-center gap-1 truncate rounded-md bg-secondary px-1 py-0.5 text-left text-secondary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <CategoryDot category={o.category} className="size-1.5" />
                    <span className="truncate">{o.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}
        </div>
      )}
      <div ref={scroller} className="max-h-[65svh] overflow-y-auto">
        <div className="relative grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))]" style={{ height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 23 }, (_, h) => (
              <span
                key={h}
                className="text-caption absolute right-1.5 -translate-y-1/2 text-muted-foreground tabular-nums"
                style={{ top: (h + 1) * HOUR_PX }}
              >
                {String(h + 1).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((d) => {
            const iso = formatIsoDate(d)
            const placed = layoutDay(byDay.get(iso) ?? [], d, timeZone)
            const isToday = sameDay(d, today)
            return (
              <div key={iso} className="relative border-l border-hairline">
                {Array.from({ length: 24 }, (_, h) => (
                  <button
                    key={h}
                    type="button"
                    tabIndex={-1}
                    aria-label={`Add an event on ${iso} at ${String(h).padStart(2, "0")}:00`}
                    onClick={() => onAdd(d, h)}
                    className="absolute inset-x-0 border-t border-hairline hover:bg-white/30 dark:hover:bg-white/5"
                    style={{ top: h * HOUR_PX, height: HOUR_PX }}
                  />
                ))}
                {placed.map(({ o, top, height, lane, lanes }) => (
                  <button
                    key={o.key}
                    type="button"
                    onClick={() => onOpen(o.eventId)}
                    className="absolute overflow-hidden rounded-md border-l-2 border-accent-500 bg-secondary px-1 py-0.5 text-left text-secondary-foreground shadow-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    style={{ top, height: Math.max(height - 2, 18), left: `calc(${(lane / lanes) * 100}% + 1px)`, width: `calc(${100 / lanes}% - 3px)` }}
                  >
                    <span className="text-caption block truncate font-semibold">{o.title}</span>
                    {height > 30 && (
                      <span className="text-caption block truncate text-muted-foreground tabular-nums">
                        {formatClock(new Date(o.start), timeZone)}
                      </span>
                    )}
                  </button>
                ))}
                {isToday && (
                  <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10" style={{ top: nowTop }}>
                    <div className="relative h-0.5 bg-accent-500">
                      <span className="absolute -top-[3px] -left-1 size-2 rounded-full bg-accent-500" />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <p className="sr-only" role="status">
        {showsToday ? `Now: ${formatClock(now, timeZone)}` : ""}
      </p>
    </div>
  )
}
