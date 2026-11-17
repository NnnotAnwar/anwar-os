"use client"

import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, Plus } from "@/components/icons"
import { Button, buttonVariants } from "@/components/ui/button"
import { removeWithUndo } from "@/lib/undo-toast"
import { cn } from "@/lib/utils"
import { addMonths, groupByDay, sameDay, startOfWeek } from "../lib/days"
import { dateLocale, formatDayMonth, formatMonthYear, formatWeekdayLong } from "../lib/format"
import { AGENDA_DAYS, calendarHref, type View } from "../lib/links"
import { parseQuickAdd } from "../lib/quick-add"
import { spanToFields, type Span } from "../lib/drag"
import { addDays, formatIsoDate, formatTime, parseIsoDate, utcMidnight, zonedToUtc, type LocalDate } from "../lib/zoned"
import type { FeedInfo, Occurrence } from "../schema"
import { createEvent, deleteEvent, getEvent, updateEvent } from "../server-actions"
import { AgendaView, NowLine } from "./agenda-view"
import { draftFields, EventEditor, type EditorState } from "./event-editor"
import { EventRow } from "./event-row"
import { FeedDialog } from "./feed-dialog"
import { MonthView } from "./month-view"
import { WeekView } from "./week-view"

type Props = {
  view: View
  anchor: string
  today: string
  now: string
  timezone: string
  locale: string
  occurrences: Occurrence[]
  openEventId: string | null
  openNew: boolean
  feed: FeedInfo
}

const formatWeekdayShort = (d: LocalDate) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(utcMidnight(d))

export function CalendarApp(props: Props) {
  const router = useRouter()
  const { view, timezone } = props
  const locale = dateLocale(props.locale)
  const anchor = parseIsoDate(props.anchor)!
  const today = parseIsoDate(props.today)!
  const now = useMemo(() => new Date(props.now), [props.now])

  const [selected, setSelected] = useState<LocalDate>(anchor)
  const [focusKey, setFocusKey] = useState(0)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [hiddenEvents, setHiddenEvents] = useState<Set<string>>(new Set())
  const [quick, setQuick] = useState("")
  const [quickError, setQuickError] = useState<string | null>(null)
  const [adding, startAdding] = useTransition()

  // Events dragged to a new time show there at once, until the server's list arrives.
  const [moved, setMoved] = useState<Map<string, { start: string; end: string }>>(new Map())
  const [lastOccurrences, setLastOccurrences] = useState(props.occurrences)
  if (lastOccurrences !== props.occurrences) {
    setLastOccurrences(props.occurrences)
    setMoved(new Map())
  }
  const visible = useMemo(
    () =>
      props.occurrences
        .filter((o) => !hiddenEvents.has(o.eventId))
        .map((o) => (!o.recurring && moved.has(o.eventId) ? { ...o, ...moved.get(o.eventId)! } : o)),
    [props.occurrences, hiddenEvents, moved],
  )
  const byDay = useMemo(() => groupByDay(visible, timezone), [visible, timezone])
  const zones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone")
    } catch {
      return [timezone, "UTC"]
    }
  }, [timezone])

  // Keep the selection when the server sends a new anchor (prev/next, deep link).
  const [lastAnchor, setLastAnchor] = useState(props.anchor)
  if (lastAnchor !== props.anchor) {
    setLastAnchor(props.anchor)
    setSelected(anchor)
  }

  // Deep links: ?new=1 opens a blank event (also when ⌘K navigates here while
  // the page is open); ?event=<id> loads that event, see the effect below.
  const deepLink = `${props.openEventId ?? ""}|${props.openNew}`
  const [lastDeepLink, setLastDeepLink] = useState("|false")
  if (lastDeepLink !== deepLink) {
    setLastDeepLink(deepLink)
    if (props.openNew && !props.openEventId) setEditor({ mode: "create", initial: draftFields(props.anchor, timezone) })
  }
  useEffect(() => {
    if (props.openEventId) void openEvent(props.openEventId)
    // Only when the linked event changes.
  }, [props.openEventId])

  function go(next: { view?: View; date?: LocalDate }, replace = false) {
    const href = calendarHref({ view: next.view ?? view, date: next.date ?? selected })
    if (replace) router.replace(href, { scroll: false })
    else router.push(href, { scroll: false })
  }

  function select(date: LocalDate, focus = false) {
    setSelected(date)
    if (focus) setFocusKey((k) => k + 1)
    if (view === "month" && date.month !== anchor.month) go({ date }, true)
    else window.history.replaceState(null, "", calendarHref({ view, date }))
  }

  function move(key: string, shift: boolean) {
    const step: Record<string, () => LocalDate> = {
      ArrowLeft: () => addDays(selected, -1),
      ArrowRight: () => addDays(selected, 1),
      ArrowUp: () => addDays(selected, -7),
      ArrowDown: () => addDays(selected, 7),
      Home: () => startOfWeek(selected),
      End: () => addDays(startOfWeek(selected), 6),
      PageUp: () => addMonths(selected, shift ? -12 : -1),
      PageDown: () => addMonths(selected, shift ? 12 : 1),
      t: () => today,
      T: () => today,
    }
    const next = step[key]?.()
    if (next) select(next, true)
  }

  function closeEditor() {
    setEditor(null)
    if (props.openEventId || props.openNew) router.replace(calendarHref({ view, date: selected }), { scroll: false })
  }

  async function openEvent(id: string) {
    const result = await getEvent({ id })
    if (!result.ok || !result.value) return void toast.error("That event no longer exists.")
    const { id: eventId, recurrenceText, ...fields } = result.value
    setEditor({ mode: "edit", id: eventId, initial: fields, recurrenceText })
  }

  function addOn(date: LocalDate, start?: number, end?: number) {
    const at = (m: number) => formatTime({ hour: Math.floor(m / 60), minute: m % 60 })
    const time = start === undefined ? undefined : { start: at(start), end: at(Math.min(end ?? start + 60, 23 * 60 + 59)) }
    setEditor({ mode: "create", initial: draftFields(formatIsoDate(date), timezone, time) })
  }

  function unmove(eventId: string) {
    setMoved((m) => {
      const copy = new Map(m)
      copy.delete(eventId)
      return copy
    })
  }

  /** Drag in the week view: moves at once, saves, and offers Undo. */
  function reschedule(o: Occurrence, span: Span, weekStart: LocalDate) {
    const next = spanToFields(span, weekStart, timezone, o.timezone)
    const date = addDays(weekStart, span.day)
    const startAt = zonedToUtc({ ...date, hour: Math.floor(span.start / 60), minute: span.start % 60 }, timezone)
    const endAt = new Date(startAt.getTime() + (span.end - span.start) * 60_000)
    setMoved((m) => new Map(m).set(o.eventId, { start: startAt.toISOString(), end: endAt.toISOString() }))
    void (async () => {
      const loaded = await getEvent({ id: o.eventId })
      if (!loaded.ok || !loaded.value) {
        unmove(o.eventId)
        return void toast.error("That event no longer exists.")
      }
      // The update schema drops recurrenceText; everything else is the event as it was.
      const before = loaded.value
      const result = await updateEvent({ ...before, ...next })
      if (!result.ok) {
        unmove(o.eventId)
        return void toast.error(result.error)
      }
      toast.success(`“${o.title}” moved to ${formatWeekdayShort(date)}, ${next.startTime}–${next.endTime}`, {
        action: {
          label: "Undo",
          onClick: async () => {
            setMoved((m) => new Map(m).set(o.eventId, { start: o.start, end: o.end }))
            const back = await updateEvent(before)
            if (!back.ok) toast.error(back.error)
          },
        },
      })
    })()
  }

  function remove(id: string, title: string) {
    setEditor(null)
    removeWithUndo({
      message: `“${title || "Event"}” deleted`,
      hide: () => setHiddenEvents((s) => new Set(s).add(id)),
      restore: () =>
        setHiddenEvents((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        }),
      commit: () => deleteEvent({ id }),
    })
  }

  function quickAdd(e: FormEvent) {
    e.preventDefault()
    const draft = parseQuickAdd(quick, selected)
    if (!draft) return setQuickError("Write what it is, e.g. “Dentist tomorrow 14:00”.")
    const date = formatIsoDate(draft.date)
    const fields = draftFields(
      date,
      timezone,
      draft.time ? { start: formatTime(draft.time.start), end: formatTime(draft.time.end) } : undefined,
    )
    startAdding(async () => {
      const result = await createEvent({ ...fields, title: draft.title, startTime: draft.time ? fields.startTime : undefined, endTime: draft.time ? fields.endTime : undefined })
      if (!result.ok) return setQuickError(result.error)
      setQuick("")
      setQuickError(null)
      const when = `${formatDayMonth(utcMidnight(draft.date), locale, "UTC")}${draft.time ? ` at ${formatTime(draft.time.start)}` : ""}`
      toast.success(`Added “${draft.title}” on ${when}`)
      // The selection stays put, so several quick adds land on the same day.
    })
  }

  // Header: title and prev/next for the current view.
  const weekStart = startOfWeek(anchor)
  const title =
    view === "month"
      ? formatMonthYear(utcMidnight(anchor), locale, "UTC")
      : view === "week"
        ? `${formatDayMonth(utcMidnight(weekStart), locale, "UTC")} – ${formatDayMonth(utcMidnight(addDays(weekStart, 6)), locale, "UTC", true)}`
        : `From ${formatDayMonth(utcMidnight(anchor), locale, "UTC", true)}`
  const shift = (dir: 1 | -1) =>
    view === "month" ? addMonths(anchor, dir) : view === "week" ? addDays(anchor, 7 * dir) : addDays(anchor, AGENDA_DAYS * dir)
  const prevLabel = { month: "Previous month", week: "Previous week", agenda: "Earlier" }[view]
  const nextLabel = { month: "Next month", week: "Next week", agenda: "Later" }[view]

  const rangeEnd =
    view === "month" ? addMonths(anchor, 1) : view === "week" ? addDays(weekStart, 7) : addDays(anchor, AGENDA_DAYS)
  const rangeStart = view === "month" ? { ...anchor, day: 1 } : view === "week" ? weekStart : anchor
  const showsToday =
    formatIsoDate(today) >= formatIsoDate(rangeStart) &&
    formatIsoDate(today) < formatIsoDate(view === "month" ? { ...rangeEnd, day: 1 } : rangeEnd)

  // Phones: swipe the month (or week) sideways to page, like Calendar on iOS.
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null)
  const swipeHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      const onEvent = (e.target as HTMLElement).closest("[data-event]")
      swipe.current = e.pointerType === "mouse" || onEvent ? null : { x: e.clientX, y: e.clientY, id: e.pointerId }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const s = swipe.current
      swipe.current = null
      if (!s || s.id !== e.pointerId) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go({ date: shift(dx < 0 ? 1 : -1) })
    },
    onPointerCancel: () => (swipe.current = null),
  }

  const selectedIso = formatIsoDate(selected)
  const dayEvents = byDay.get(selectedIso) ?? []
  const selectedIsToday = sameDay(selected, today)

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Link href={calendarHref({ view, date: shift(-1) })} scroll={false} aria-label={prevLabel} className={buttonVariants({ variant: "ghost", size: "icon-lg" })}>
            <ChevronLeft />
          </Link>
          <Link href={calendarHref({ view, date: shift(1) })} scroll={false} aria-label={nextLabel} className={buttonVariants({ variant: "ghost", size: "icon-lg" })}>
            <ChevronRight />
          </Link>
          {/* The Today pill lights up when today is off screen: one tap back. */}
          <Link
            href={calendarHref({ view, date: today })}
            scroll={false}
            aria-label="Go to today (T)"
            className={cn(
              buttonVariants({ variant: "outline", size: "lg" }),
              "rounded-full px-3.5 transition-colors",
              !showsToday && "border-accent-300 bg-secondary text-text-accent hover:bg-secondary",
            )}
          >
            Today
          </Link>
        </div>
        <h2 className="text-card-title min-w-0 flex-1 truncate tabular-nums max-sm:order-first max-sm:basis-full" aria-live="polite">
          {title}
        </h2>
        <nav aria-label="View" className="segmented">
          {(["month", "week", "agenda"] as const).map((v) => (
            <Link
              key={v}
              href={calendarHref({ view: v, date: selected })}
              scroll={false}
              aria-current={v === view ? "page" : undefined}
              className={cn(
                "text-small flex h-7 items-center rounded-lg px-2.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                v === view && "segment-active text-foreground",
              )}
            >
              {{ month: "Month", week: "Week", agenda: "Agenda" }[v]}
            </Link>
          ))}
        </nav>
        <FeedDialog initial={props.feed} />
        <Button size="lg" onClick={() => addOn(selected)}>
          <Plus />
          New event
        </Button>
      </div>

      <form onSubmit={quickAdd} className="grid gap-1">
        <label htmlFor="quick-add" className="sr-only">
          Quick add
        </label>
        <div className="flex gap-2">
          <input
            id="quick-add"
            value={quick}
            onChange={(e) => {
              setQuick(e.target.value)
              setQuickError(null)
            }}
            placeholder={`Quick add on ${formatDayMonth(utcMidnight(selected), locale, "UTC")} — e.g. Dentist tomorrow 14:00`}
            autoComplete="off"
            aria-describedby={quickError ? "quick-error" : undefined}
            className="text-meta h-9 min-w-0 flex-1 rounded-lg border border-field-border bg-field px-3 outline-none placeholder:text-muted-foreground focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-ring/20"
          />
          <Button type="submit" variant="outline" size="lg" disabled={adding || !quick.trim()}>
            Add
          </Button>
        </div>
        {quickError && (
          <p id="quick-error" role="alert" className="text-caption text-destructive">
            {quickError}
          </p>
        )}
      </form>

      {view === "agenda" ? (
        <AgendaView from={anchor} days={AGENDA_DAYS} today={today} now={now} byDay={byDay} timeZone={timezone} locale={locale} onOpen={(id) => void openEvent(id)} />
      ) : view === "week" ? (
        <div {...swipeHandlers} className="touch-pan-y">
        <WeekView
          anchor={anchor}
          today={today}
          now={now}
          byDay={byDay}
          timeZone={timezone}
          onSelectDay={(d) => go({ view: "month", date: d })}
          onOpen={(id) => void openEvent(id)}
          onAdd={(d, start, end) => addOn(d, start, end)}
          onReschedule={reschedule}
        />
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div {...swipeHandlers} className="min-w-0 touch-pan-y">
          <MonthView
            anchor={anchor}
            selected={selected}
            today={today}
            byDay={byDay}
            timeZone={timezone}
            onSelect={(d) => select(d)}
            onMove={move}
            onAdd={(d) => addOn(d)}
            onOpen={(id) => void openEvent(id)}
            focusKey={focusKey}
          />
          </div>
          <section aria-labelledby="day-heading" className="glass grid content-start gap-2 rounded-xl p-3">
            <header className="flex items-center justify-between gap-2 px-1">
              <h3 id="day-heading" className="grid gap-0.5">
                <span className={cn("text-micro", selectedIsToday ? "text-text-accent" : "text-muted-foreground")}>
                  {selectedIsToday ? "Today" : formatWeekdayLong(utcMidnight(selected), locale, "UTC")}
                </span>
                <span className="text-card-title tabular-nums">{formatDayMonth(utcMidnight(selected), locale, "UTC", selected.year !== today.year)}</span>
              </h3>
              <Button variant="ghost" size="icon" aria-label={`Add an event on ${selectedIso}`} onClick={() => addOn(selected)}>
                <Plus />
              </Button>
            </header>
            {dayEvents.length === 0 ? (
              <>
                {selectedIsToday && <NowLine />}
                <p className="text-meta px-1 text-muted-foreground">Nothing planned. Double-click a day or press Enter to add.</p>
              </>
            ) : (
              <ul className="grid gap-0.5">
                {dayEvents.map((o, i) => {
                  const showNow = selectedIsToday && !o.allDay && new Date(o.start) > now && (i === 0 || new Date(dayEvents[i - 1]!.start) <= now || dayEvents[i - 1]!.allDay)
                  return (
                    <li key={o.key}>
                      {showNow && <NowLine />}
                      <EventRow o={o} day={selectedIso} timeZone={timezone} past={selectedIsToday && !o.allDay && new Date(o.end) < now} onOpen={(id) => void openEvent(id)} />
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="text-caption px-1 text-muted-foreground max-lg:hidden">
              Arrows move, PageUp/PageDown change month, T for today.
            </p>
          </section>
        </div>
      )}

      <EventEditor state={editor} onClose={closeEditor} onDelete={remove} zones={zones} />
    </div>
  )
}
