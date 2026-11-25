"use client"

import { useEffect, useRef, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"
import { monthGrid, sameDay } from "../lib/days"
import { formatClock } from "../lib/format"
import { formatIsoDate, wallClock, weekdayOf, type LocalDate } from "../lib/zoned"
import type { Occurrence } from "../schema"
import { CategoryDot } from "./event-row"

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/**
 * A 6-week month grid as an ARIA grid with a roving tab stop. Arrows move a
 * day / week, Home/End go to the week's ends, PageUp/PageDown change month,
 * T jumps to today, Enter adds an event on the selected day.
 */
export function MonthView({
  anchor,
  selected,
  today,
  byDay,
  onSelect,
  onMove,
  onAdd,
  onOpen,
  focusKey,
  timeZone,
}: {
  timeZone: string
  anchor: LocalDate
  selected: LocalDate
  today: LocalDate
  byDay: Map<string, Occurrence[]>
  onSelect: (date: LocalDate) => void
  onMove: (key: string, shift: boolean) => void
  onAdd: (date: LocalDate) => void
  onOpen: (eventId: string) => void
  /** Changes when keyboard navigation should pull focus to the selected day. */
  focusKey: number
}) {
  const days = monthGrid(anchor)
  const grid = useRef<HTMLDivElement>(null)
  const selectedIso = formatIsoDate(selected)

  // After a keyboard move, focus follows the selection — including after the
  // grid for another month arrives from the server.
  const anchorIso = formatIsoDate(anchor)
  const handled = useRef(0)
  useEffect(() => {
    if (focusKey === handled.current) return
    const cell = grid.current?.querySelector<HTMLElement>(`[data-date="${selectedIso}"]`)
    if (!cell) return
    cell.focus()
    // Until the server sends the selected month, the cell may be replaced.
    if (selected.month === anchor.month) handled.current = focusKey
  }, [focusKey, selectedIso, anchorIso, selected.month, anchor.month])

  function onKeyDown(e: KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "t", "T"].includes(e.key)) {
      e.preventDefault()
      onMove(e.key, e.shiftKey)
    } else if (e.key === "Enter" && e.target instanceof HTMLElement && e.target.dataset.date) {
      e.preventDefault()
      onAdd(selected)
    }
  }

  return (
    <div ref={grid} role="grid" aria-label="Month" onKeyDown={onKeyDown} className="glass overflow-hidden rounded-xl">
      <div role="row" className="grid grid-cols-7 border-b border-hairline">
        {WEEKDAYS.map((d) => (
          <div key={d} role="columnheader" className="text-micro py-2 text-center text-muted-foreground">
            <abbr title={d} className="no-underline">
              {d}
            </abbr>
          </div>
        ))}
      </div>
      {Array.from({ length: 6 }, (_, w) => (
        <div role="row" key={w} className="grid grid-cols-7 border-b border-hairline last:border-b-0">
          {days.slice(w * 7, w * 7 + 7).map((day) => {
            const iso = formatIsoDate(day)
            const events = byDay.get(iso) ?? []
            const inMonth = day.month === anchor.month
            const isToday = sameDay(day, today)
            const isSelected = sameDay(day, selected)
            const weekend = weekdayOf(day) >= 6
            return (
              <div
                key={iso}
                role="gridcell"
                aria-selected={isSelected}
                className={cn("relative min-h-14 border-r border-hairline last:border-r-0 sm:min-h-24", weekend && "bg-muted/40")}
              >
                <button
                  type="button"
                  data-date={iso}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => onSelect(day)}
                  onDoubleClick={() => onAdd(day)}
                  aria-label={`${new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(Date.UTC(day.year, day.month - 1, day.day))}${isToday ? ", today" : ""}, ${events.length ? `${events.length} ${events.length === 1 ? "event" : "events"}` : "no events"}`}
                  className={cn(
                    "absolute inset-0 rounded-none outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset",
                    isSelected && "bg-secondary",
                  )}
                />
                {/* One column no wider than the cell (grid-cols-1), so long titles truncate there. */}
                <div className="pointer-events-none relative grid grid-cols-1 gap-1 p-1 sm:p-1.5">
                  <span
                    className={cn(
                      "text-small flex size-6 items-center justify-center rounded-full tabular-nums",
                      !inMonth && "text-muted-foreground/60",
                      isToday && "bg-accent-500 font-semibold text-white",
                    )}
                  >
                    {day.day}
                  </span>
                  {/* Phones: dots. Wider: up to three titles. */}
                  {events.length > 0 && (
                    <span className="flex flex-wrap gap-0.5 px-1 sm:hidden" aria-hidden>
                      {events.slice(0, 4).map((o) => (
                        <CategoryDot key={o.key} category={o.category} className="size-1.5" />
                      ))}
                    </span>
                  )}
                  <ul className="hidden grid-cols-1 gap-0.5 sm:grid">
                    {events.slice(0, 3).map((o) => (
                      <li key={o.key}>
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-label={`Open ${o.title}`}
                          onClick={() => onOpen(o.eventId)}
                          className={cn(
                            "text-caption pointer-events-auto flex w-full items-center gap-1 truncate rounded-md px-1 py-0.5 text-left hover:bg-white/60 dark:hover:bg-white/10",
                            !inMonth && "opacity-60",
                          )}
                        >
                          <CategoryDot category={o.category} className="size-1.5" />
                          {!o.allDay && iso === formatIsoDate(wallClock(new Date(o.start), timeZone)) && (
                            <span className="shrink-0 text-muted-foreground tabular-nums">{formatClock(new Date(o.start), timeZone)}</span>
                          )}
                          <span className="truncate">{o.title}</span>
                        </button>
                      </li>
                    ))}
                    {events.length > 3 && (
                      <li className="text-caption px-1 text-muted-foreground tabular-nums">+{events.length - 3} more</li>
                    )}
                  </ul>
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
