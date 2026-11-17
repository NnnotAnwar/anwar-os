"use client"

import { useEffect, useRef, useState } from "react"
import { Plus } from "@/components/icons"
import { cn } from "@/lib/utils"
import { minutesIntoDay, sameDay, startOfWeek } from "../lib/days"
import { dragSpan, slotAt, type Span } from "../lib/drag"
import { formatClock } from "../lib/format"
import { addDays, formatIsoDate, formatTime, wallClock, type LocalDate } from "../lib/zoned"
import type { Occurrence } from "../schema"
import { CategoryDot } from "./event-row"

const HOUR_PX = 44
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const TOUCH_HOLD_MS = 350

type Placed = { o: Occurrence; top: number; height: number; lane: number; lanes: number; startMin: number; endMin: number }

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
      placed.push({
        o: c.o,
        top: (c.startMin / 60) * HOUR_PX,
        height: ((c.endMin - c.startMin) / 60) * HOUR_PX,
        lane: c.lane,
        lanes,
        startMin: c.startMin,
        endMin: c.endMin,
      })
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

const clock = (min: number) => formatTime({ hour: Math.floor(min / 60) % 24, minute: min % 60 })

type DragState = {
  o: Occurrence
  mode: "move" | "resize"
  from: Span
  span: Span
  pointerId: number
  x0: number
  y0: number
  started: boolean
  colWidth: number
}

/**
 * The week as seven day columns. Tap an empty slot to add an event at that
 * half hour (a "+ 09:30" ghost shows where on hover). Drag an event to move
 * it (also to another day), drag its bottom edge to change its length; on
 * touch, hold it first. Repeating and all-day events open the editor instead.
 */
export function WeekView({
  anchor,
  today,
  now,
  byDay,
  timeZone,
  onSelectDay,
  onOpen,
  onAdd,
  onReschedule,
}: {
  anchor: LocalDate
  today: LocalDate
  now: Date
  byDay: Map<string, Occurrence[]>
  timeZone: string
  onSelectDay: (date: LocalDate) => void
  onOpen: (eventId: string) => void
  onAdd: (date: LocalDate, start: number, end: number) => void
  onReschedule: (o: Occurrence, span: Span, weekStart: LocalDate) => void
}) {
  const monday = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i))
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLDivElement>(null)
  const nowWall = wallClock(now, timeZone)
  const nowTop = ((nowWall.hour * 60 + nowWall.minute) / 60) * HOUR_PX
  const showsToday = days.some((d) => sameDay(d, today))
  const [hover, setHover] = useState<{ day: number; start: number } | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const suppressClick = useRef(false)

  // Open scrolled to just before now (or 07:00 on other weeks).
  useEffect(() => {
    const target = showsToday ? Math.max(0, nowTop - 2 * HOUR_PX) : 7 * HOUR_PX
    scroller.current?.scrollTo({ top: target })
  }, [showsToday, nowTop])

  const allDay = days.map((d) => (byDay.get(formatIsoDate(d)) ?? []).filter((o) => o.allDay))
  const hasAllDay = allDay.some((l) => l.length > 0)

  function update(next: DragState | null) {
    dragRef.current = next
    setDrag(next)
  }

  function startDrag(e: React.PointerEvent, p: Placed, dayIndex: number, mode: "move" | "resize") {
    if (e.button !== 0 || p.o.recurring) return
    e.stopPropagation()
    const colWidth = (grid.current?.getBoundingClientRect().width ?? 0) / 7
    const from = { day: dayIndex, start: p.startMin, end: p.endMin }
    const state: DragState = { o: p.o, mode, from, span: from, pointerId: e.pointerId, x0: e.clientX, y0: e.clientY, started: false, colWidth }
    dragRef.current = state
    const target = e.currentTarget as HTMLElement
    const isTouch = e.pointerType !== "mouse"

    const begin = () => {
      const d = dragRef.current
      if (!d || d.started) return
      d.started = true
      suppressClick.current = true
      navigator.vibrate?.(8)
      try {
        target.setPointerCapture(d.pointerId)
      } catch {}
      update({ ...d })
    }
    const holdTimer = isTouch ? window.setTimeout(begin, TOUCH_HOLD_MS) : 0

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d || ev.pointerId !== d.pointerId) return
      const dx = ev.clientX - d.x0
      const dy = ev.clientY - d.y0
      if (!d.started) {
        if (isTouch) {
          // Moving before the hold is a scroll, not a drag.
          if (Math.hypot(dx, dy) > 8) end(false)
          return
        }
        if (Math.hypot(dx, dy) < 4) return
        begin()
      }
      const span = dragSpan(
        d.from,
        { minutes: (dy / HOUR_PX) * 60, days: d.mode === "move" && d.colWidth ? Math.round(dx / d.colWidth) : 0 },
        d.mode,
      )
      if (span.day !== d.span.day || span.start !== d.span.start || span.end !== d.span.end) update({ ...d, span })
    }
    const blockScroll = (ev: TouchEvent) => dragRef.current?.started && ev.preventDefault()
    const onUp = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d || ev.pointerId !== d.pointerId) return
      end(d.started)
    }
    const end = (commit: boolean) => {
      window.clearTimeout(holdTimer)
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      window.removeEventListener("pointercancel", onCancel)
      window.removeEventListener("touchmove", blockScroll)
      const d = dragRef.current
      update(null)
      if (commit && d) {
        const moved = d.span.day !== d.from.day || d.span.start !== d.from.start || d.span.end !== d.from.end
        if (moved) onReschedule(d.o, d.span, monday)
      }
      window.setTimeout(() => (suppressClick.current = false), 0)
    }
    const onCancel = () => end(false)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
    window.addEventListener("pointercancel", onCancel)
    window.addEventListener("touchmove", blockScroll, { passive: false })
  }

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
              className="grid min-h-11 justify-items-center gap-1 py-2 outline-none hover:bg-white/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset dark:hover:bg-white/5"
              aria-label={`Open ${formatIsoDate(d)} in the month view`}
            >
              <span className={cn("text-micro", isToday ? "text-text-accent" : "text-muted-foreground")}>{WEEKDAYS[i]}</span>
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
      <div ref={scroller} className="max-h-[65svh] overflow-y-auto overscroll-contain">
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
          <div ref={grid} className="col-span-7 grid grid-cols-7">
            {days.map((d, dayIndex) => {
              const iso = formatIsoDate(d)
              const placed = layoutDay(byDay.get(iso) ?? [], d, timeZone)
              const isToday = sameDay(d, today)
              const ghost = drag?.started && drag.span.day === dayIndex ? drag.span : null
              return (
                <div
                  key={iso}
                  className={cn("relative cursor-cell border-l border-hairline", isToday && "bg-accent-500/[0.03]")}
                  // Tap an empty slot: a new event at that half hour.
                  onClick={(e) => {
                    if (suppressClick.current || e.target !== e.currentTarget) return
                    const { start, end } = slotAt(e.nativeEvent.offsetY, HOUR_PX)
                    onAdd(d, start, end)
                  }}
                  onPointerMove={(e) => {
                    if (e.pointerType !== "mouse" || drag || e.target !== e.currentTarget) return setHover(null)
                    const { start } = slotAt(e.nativeEvent.offsetY, HOUR_PX)
                    if (hover?.day !== dayIndex || hover.start !== start) setHover({ day: dayIndex, start })
                  }}
                  onPointerLeave={() => setHover(null)}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-hairline" style={{ top: h * HOUR_PX }} />
                  ))}
                  {hover?.day === dayIndex && !drag && (
                    <div
                      aria-hidden
                      className="text-caption pointer-events-none absolute inset-x-0.5 flex items-start gap-0.5 rounded-md border border-dashed border-accent-400 bg-secondary/60 px-1 py-0.5 text-text-accent tabular-nums"
                      style={{ top: (hover.start / 60) * HOUR_PX, height: HOUR_PX - 2 }}
                    >
                      <Plus className="mt-0.5 size-3 shrink-0" />
                      <span className="truncate">{clock(hover.start)}</span>
                    </div>
                  )}
                  {placed.map((p) => {
                    const { o, top, height, lane, lanes } = p
                    const isDragged = drag?.started && drag.o.key === o.key
                    return (
                      <button
                        key={o.key}
                        type="button"
                        data-event
                        onPointerDown={(e) => startDrag(e, p, dayIndex, "move")}
                        onClick={(e) => {
                          if (suppressClick.current) return e.preventDefault()
                          onOpen(o.eventId)
                        }}
                        title={o.recurring ? `${o.title} — repeats; open to change` : `${o.title} — drag to move`}
                        className={cn(
                          "group absolute touch-manipulation overflow-hidden rounded-md border-l-2 border-accent-500 bg-secondary px-1 py-0.5 text-left text-secondary-foreground shadow-sm outline-none select-none [-webkit-touch-callout:none] focus-visible:ring-3 focus-visible:ring-ring/50",
                          !o.recurring && "cursor-grab active:cursor-grabbing",
                          isDragged && "opacity-30",
                        )}
                        style={{ top, height: Math.max(height - 2, 18), left: `calc(${(lane / lanes) * 100}% + 1px)`, width: `calc(${100 / lanes}% - 3px)` }}
                      >
                        <span className="text-caption block truncate font-semibold">{o.title}</span>
                        {height > 30 && (
                          <span className="text-caption block truncate text-muted-foreground tabular-nums">
                            {formatClock(new Date(o.start), timeZone)}
                          </span>
                        )}
                        {!o.recurring && height > 24 && (
                          <span
                            aria-hidden
                            onPointerDown={(e) => startDrag(e, p, dayIndex, "resize")}
                            className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 pointer-coarse:h-3"
                          >
                            <span className="mx-auto mt-0.5 block h-0.5 w-6 rounded-full bg-accent-500/60" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                  {ghost && drag && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0.5 z-20 overflow-hidden rounded-md border-l-2 border-accent-500 bg-primary/90 px-1 py-0.5 text-primary-foreground shadow-(--shadow-glass-lg)"
                      style={{ top: (ghost.start / 60) * HOUR_PX, height: Math.max(((ghost.end - ghost.start) / 60) * HOUR_PX - 2, 18) }}
                    >
                      <span className="text-caption block truncate font-semibold">{drag.o.title}</span>
                      <span className="text-caption block truncate tabular-nums opacity-90">
                        {clock(ghost.start)}–{clock(ghost.end)}
                      </span>
                    </div>
                  )}
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
      </div>
      <p className="text-caption border-t border-hairline px-3 py-2 text-muted-foreground">
        <span className="pointer-coarse:hidden">Click an empty slot to add an event. Drag an event to move it, its bottom edge to resize.</span>
        <span className="pointer-fine:hidden">Tap an empty slot to add an event. Hold an event, then drag to move it.</span>
      </p>
      <p className="sr-only" role="status">
        {showsToday ? `Now: ${formatClock(now, timeZone)}` : ""}
      </p>
    </div>
  )
}
