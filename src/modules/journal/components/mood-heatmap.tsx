"use client"

import { useRouter } from "next/navigation"
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { cn } from "@/lib/utils"
import { addDays, type HeatCell, type HeatMap } from "../lib/days"
import { formatDayShort } from "../lib/format"
import { MOODS, moodOf, type Mood } from "../schema"

// A GitHub-style year of moods: one column per week, Monday at the top, the
// accent getting stronger from a bad day to a great one. One tab stop: the
// arrow keys move by day (up/down) and week (left/right), Enter opens the day.

const ROW_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"]

/** Accent strength per mood: one hue, so it reads the same in both themes and without colour vision. */
export const moodFill: Record<Mood, string> = {
  1: "bg-accent-500/20 dark:bg-accent-400/20",
  2: "bg-accent-500/40 dark:bg-accent-400/40",
  3: "bg-accent-500/60 dark:bg-accent-400/60",
  4: "bg-accent-500/80 dark:bg-accent-400/80",
  5: "bg-accent-600 dark:bg-accent-300",
}

function describe(cell: HeatCell, year: number) {
  const day = formatDayShort(cell.day, year)
  if (cell.future) return `${day}: still to come`
  const mood = moodOf(cell.mood)
  if (mood) return `${day}: ${mood.label}${cell.hasText ? ", with a line" : ""}`
  return cell.hasText ? `${day}: a line, no mood` : `${day}: nothing written`
}

export function MoodHeatmap({ map, today, selected, dayHref }: { map: HeatMap; today: string; selected: string | null; dayHref: string }) {
  const router = useRouter()
  const cells = new Map(map.weeks.flat().flatMap((c) => (c ? [[c.day, c] as const] : [])))
  const first = `${map.year}-01-01`
  const last = `${map.year}-12-31`
  const start = selected && cells.has(selected) ? selected : today >= first && today <= last ? today : last
  const [focus, setFocus] = useState(start)
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const scroller = useRef<HTMLDivElement>(null)

  // On a phone the year is wider than the screen: start at the focused week (usually now).
  useEffect(() => {
    const el = refs.current.get(start)
    const box = scroller.current
    if (el && box && box.scrollWidth > box.clientWidth) box.scrollLeft = el.offsetLeft - box.clientWidth / 2
  }, [start])

  function open(day: string) {
    const href = dayHref.replace("__DAY__", day)
    router.push(href, { scroll: false })
  }

  function onKeyDown(event: KeyboardEvent, day: string) {
    const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[event.key]
    let next: string | null = null
    if (step !== undefined) next = addDays(day, step)
    else if (event.key === "Home") next = first
    else if (event.key === "End") next = today >= first && today <= last ? today : last
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      if (!cells.get(day)?.future) open(day)
      return
    }
    if (!next) return
    event.preventDefault()
    if (!cells.has(next)) return
    setFocus(next)
    refs.current.get(next)?.focus()
  }

  return (
    <div className="grid gap-3">
      <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        <div className="relative w-max [--cell:0.625rem] [--gap:3px]">
          <div className="relative ml-8 h-4" aria-hidden>
            {map.months.map((m) => (
              <span
                key={m.label}
                className="text-micro absolute top-0 text-muted-foreground"
                style={{ left: `calc(var(--gap) + ${m.column} * (var(--cell) + var(--gap)))` }}
              >
                {m.label}
              </span>
            ))}
          </div>
          <div role="grid" aria-label={`Moods in ${map.year}`} className="grid gap-[var(--gap)]">
            {ROW_LABELS.map((label, row) => (
              <div role="row" key={row} className="flex items-center gap-[var(--gap)]">
                <span role="rowheader" className="text-micro w-8 shrink-0 text-muted-foreground" aria-label={["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][row]}>
                  <span aria-hidden>{label}</span>
                </span>
                {map.weeks.map((week, column) => {
                  const cell = week[row]
                  if (!cell) return <span key={column} role="gridcell" className="size-[var(--cell)] shrink-0" />
                  const isToday = cell.day === today
                  return (
                    <span key={column} role="gridcell" className="flex">
                      <button
                        type="button"
                        ref={(el) => {
                          if (el) refs.current.set(cell.day, el)
                          else refs.current.delete(cell.day)
                        }}
                        tabIndex={cell.day === focus ? 0 : -1}
                        aria-label={describe(cell, map.year)}
                        aria-current={isToday ? "date" : undefined}
                        aria-pressed={cell.day === selected}
                        aria-disabled={cell.future || undefined}
                        title={describe(cell, map.year)}
                        onClick={() => !cell.future && open(cell.day)}
                        onFocus={() => setFocus(cell.day)}
                        onKeyDown={(e) => onKeyDown(e, cell.day)}
                        className={cn(
                          "size-[var(--cell)] shrink-0 rounded-[3px] outline-none transition-shadow",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                          cell.mood
                            ? moodFill[cell.mood]
                            : cell.hasText
                              ? "bg-track ring-1 ring-inset ring-accent-500/60"
                              : cell.future
                                ? "bg-track/40 cursor-default"
                                : "bg-track",
                          isToday && "ring-1 ring-foreground/50",
                          cell.day === selected && "ring-2 ring-foreground",
                        )}
                      />
                    </span>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <Legend />
    </div>
  )
}

function Legend() {
  return (
    <div className="text-caption flex flex-wrap items-center gap-x-4 gap-y-2 text-muted-foreground" aria-label="Legend">
      <span className="flex items-center gap-1.5">
        <span aria-hidden>{MOODS[0].emoji}</span>
        <span className="sr-only">Bad</span>
        {MOODS.map((m) => (
          <span key={m.value} className={cn("size-[0.625rem] rounded-[3px]", moodFill[m.value])} title={m.label} aria-hidden />
        ))}
        <span aria-hidden>{MOODS[4].emoji}</span>
        <span className="sr-only">to great: the stronger the colour, the better the day</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-[0.625rem] rounded-[3px] bg-track ring-1 ring-inset ring-accent-500/60" aria-hidden />A line, no mood
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-[0.625rem] rounded-[3px] bg-track" aria-hidden />
        Nothing written
      </span>
    </div>
  )
}
