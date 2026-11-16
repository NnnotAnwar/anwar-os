"use client"

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react"
import { Trash2 } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { calendarCategories, categoryInfo } from "../lib/categories"
import { addDays, compareDates, formatIsoDate, parseIsoDate, parseTime, weekdayOf } from "../lib/zoned"
import { REMINDER_CHOICES, reminderLabel, type EventFields, type RepeatInput } from "../schema"
import { createEvent, updateEvent } from "../server-actions"

export type EditorState =
  | { mode: "create"; initial: EventFields }
  | { mode: "edit"; id: string; initial: EventFields; recurrenceText: string | null }

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const selectClass =
  "h-8 w-full rounded-lg border border-field-border bg-field px-2.5 text-sm outline-none focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-ring/20 dark:[color-scheme:dark]"

/** Fields for a new event on `date`: all-day, or one hour from `time`. */
export function draftFields(date: string, timezone: string, time?: { start: string; end: string }): EventFields {
  return {
    title: "",
    notes: "",
    location: "",
    category: "personal",
    allDay: !time,
    startDate: date,
    endDate: date,
    startTime: time?.start ?? "09:00",
    endTime: time?.end ?? "10:00",
    timezone,
    repeat: null,
    reminders: [],
  }
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-meta text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  )
}

export function EventEditor({
  state,
  onClose,
  onDelete,
  zones,
}: {
  state: EditorState | null
  onClose: () => void
  onDelete: (id: string, title: string) => void
  zones: string[]
}) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass glass-menu max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-lg">
        {state && (
          <EditorForm
            key={state.mode === "edit" ? state.id : `new:${state.initial.startDate}:${state.initial.title}`}
            state={state}
            onClose={onClose}
            onDelete={onDelete}
            zones={zones}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditorForm({
  state,
  onClose,
  onDelete,
  zones,
}: {
  state: EditorState
  onClose: () => void
  onDelete: (id: string, title: string) => void
  zones: string[]
}) {
  const [f, setF] = useState<EventFields>(state.initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = <K extends keyof EventFields>(key: K, value: EventFields[K]) => {
    setF((prev) => ({ ...prev, [key]: value }))
    setError(null)
  }
  const setRepeat = (next: Partial<RepeatInput> | null) =>
    setF((prev) => ({
      ...prev,
      repeat: next === null ? null : { freq: "weekly", interval: 1, ends: { type: "never" }, ...prev.repeat, ...next },
    }))

  const startDate = parseIsoDate(f.startDate)
  const startWeekday = startDate ? weekdayOf(startDate) : 1
  const zoneOptions = useMemo(() => [...new Set([f.timezone, ...zones])].sort(), [f.timezone, zones])

  function changeStartDate(value: string) {
    // Keep the length: moving the start moves the end with it.
    const prevStart = parseIsoDate(f.startDate)
    const prevEnd = parseIsoDate(f.endDate)
    const next = parseIsoDate(value)
    if (prevStart && prevEnd && next) {
      const span = -compareDates(prevStart, prevEnd)
      setF((p) => ({ ...p, startDate: value, endDate: formatIsoDate(addDays(next, Math.max(0, span))) }))
    } else set("startDate", value)
  }

  function changeStartTime(value: string) {
    const prev = parseTime(f.startTime)
    const prevEnd = parseTime(f.endTime)
    const next = parseTime(value)
    if (prev && prevEnd && next && f.startDate === f.endDate) {
      const length = prevEnd.hour * 60 + prevEnd.minute - (prev.hour * 60 + prev.minute)
      const end = Math.min(next.hour * 60 + next.minute + Math.max(length, 0), 23 * 60 + 59)
      setF((p) => ({ ...p, startTime: value, endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` }))
    } else set("startTime", value)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const payload: EventFields = {
      ...f,
      startTime: f.allDay ? undefined : f.startTime,
      endTime: f.allDay ? undefined : f.endTime,
    }
    start(async () => {
      const result = state.mode === "edit" ? await updateEvent({ id: state.id, ...payload }) : await createEvent(payload)
      if (result.ok) onClose()
      else setError(result.error)
    })
  }

  const repeat = f.repeat
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle className="text-card-title">{state.mode === "edit" ? "Edit event" : "New event"}</DialogTitle>
        {state.mode === "edit" && state.recurrenceText && (
          <DialogDescription>Repeats: {state.recurrenceText}. Changes apply to every repeat.</DialogDescription>
        )}
      </DialogHeader>

      <Field label="Title" htmlFor="ev-title">
        <Input id="ev-title" value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Dentist" maxLength={200} autoFocus autoComplete="off" required />
      </Field>

      <label className="text-meta flex items-center gap-2">
        <input type="checkbox" checked={f.allDay} onChange={(e) => set("allDay", e.target.checked)} className="size-4 accent-[var(--color-accent-600)]" />
        All day
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts" htmlFor="ev-start-date">
          <Input id="ev-start-date" type="date" value={f.startDate} onChange={(e) => changeStartDate(e.target.value)} required className="dark:[color-scheme:dark]" />
        </Field>
        {!f.allDay ? (
          <Field label="at" htmlFor="ev-start-time">
            <Input id="ev-start-time" type="time" value={f.startTime ?? ""} onChange={(e) => changeStartTime(e.target.value)} required className="tabular-nums dark:[color-scheme:dark]" />
          </Field>
        ) : (
          <span />
        )}
        <Field label="Ends" htmlFor="ev-end-date">
          <Input id="ev-end-date" type="date" value={f.endDate} min={f.startDate} onChange={(e) => set("endDate", e.target.value)} required className="dark:[color-scheme:dark]" />
        </Field>
        {!f.allDay && (
          <Field label="at" htmlFor="ev-end-time">
            <Input id="ev-end-time" type="time" value={f.endTime ?? ""} onChange={(e) => set("endTime", e.target.value)} required className="tabular-nums dark:[color-scheme:dark]" />
          </Field>
        )}
      </div>

      {!f.allDay && (
        <Field label="Time zone" htmlFor="ev-zone">
          <select id="ev-zone" value={f.timezone} onChange={(e) => set("timezone", e.target.value)} className={selectClass}>
            {zoneOptions.map((z) => (
              <option key={z} value={z}>
                {z.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" htmlFor="ev-category">
          <select id="ev-category" value={f.category} onChange={(e) => set("category", e.target.value as EventFields["category"])} className={selectClass}>
            {calendarCategories.map((c) => (
              <option key={c} value={c}>
                {categoryInfo[c].label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Repeats" htmlFor="ev-repeat">
          <select
            id="ev-repeat"
            value={repeat?.freq ?? "none"}
            onChange={(e) => (e.target.value === "none" ? setRepeat(null) : setRepeat({ freq: e.target.value as RepeatInput["freq"] }))}
            className={selectClass}
          >
            <option value="none">Doesn&apos;t repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
      </div>

      {repeat && (
        <fieldset className="grid gap-3 rounded-xl bg-muted p-3">
          <legend className="sr-only">Repeat details</legend>
          <div className="text-meta flex flex-wrap items-center gap-2">
            <label htmlFor="ev-interval">Every</label>
            <Input
              id="ev-interval"
              type="number"
              min={1}
              max={99}
              value={repeat.interval}
              onChange={(e) => setRepeat({ interval: Math.max(1, Math.min(99, Number(e.target.value) || 1)) })}
              className="h-8 w-16 text-right tabular-nums"
            />
            <span>{{ daily: "day", weekly: "week", monthly: "month", yearly: "year" }[repeat.freq]}{repeat.interval > 1 ? "s" : ""}</span>
          </div>
          {repeat.freq === "weekly" && (
            <div role="group" aria-label="On these days" className="flex flex-wrap gap-1">
              {WEEKDAYS.map((label, i) => {
                const day = i + 1
                const isStart = day === startWeekday
                const on = isStart || (repeat.byWeekday ?? []).includes(day)
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    disabled={isStart}
                    title={isStart ? "The start day is always included" : undefined}
                    onClick={() => {
                      const current = new Set(repeat.byWeekday ?? [])
                      if (current.has(day)) current.delete(day)
                      else current.add(day)
                      setRepeat({ byWeekday: [...current].sort() })
                    }}
                    className={cn(
                      "text-small h-8 min-w-11 rounded-lg px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                      on ? "bg-primary text-primary-foreground" : "bg-field text-muted-foreground hover:text-foreground",
                      isStart && "opacity-80",
                    )}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}
          <div className="text-meta flex flex-wrap items-center gap-2">
            <label htmlFor="ev-ends">Ends</label>
            <select
              id="ev-ends"
              value={repeat.ends.type}
              onChange={(e) => {
                const type = e.target.value
                setRepeat({
                  ends:
                    type === "until"
                      ? { type, date: formatIsoDate(addDays(startDate ?? { year: 2026, month: 1, day: 1 }, 90)) }
                      : type === "count"
                        ? { type, count: 10 }
                        : { type: "never" },
                })
              }}
              className={cn(selectClass, "w-auto")}
            >
              <option value="never">Never</option>
              <option value="until">On a date</option>
              <option value="count">After a number of times</option>
            </select>
            {repeat.ends.type === "until" && (
              <Input
                type="date"
                aria-label="Last date"
                value={repeat.ends.date}
                min={f.startDate}
                onChange={(e) => setRepeat({ ends: { type: "until", date: e.target.value } })}
                className="h-8 w-auto dark:[color-scheme:dark]"
              />
            )}
            {repeat.ends.type === "count" && (
              <Input
                type="number"
                aria-label="Number of times"
                min={1}
                max={999}
                value={repeat.ends.count}
                onChange={(e) => setRepeat({ ends: { type: "count", count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) } })}
                className="h-8 w-20 text-right tabular-nums"
              />
            )}
          </div>
        </fieldset>
      )}

      <Field label="Location" htmlFor="ev-location">
        <Input id="ev-location" value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Vinohradská 12, Prague" maxLength={300} autoComplete="off" />
      </Field>

      <fieldset className="grid gap-1.5">
        <legend className="text-meta mb-1.5 text-muted-foreground">Reminders</legend>
        <div className="flex flex-wrap gap-1">
          {REMINDER_CHOICES.map((m) => {
            const on = f.reminders.includes(m)
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                disabled={!on && f.reminders.length >= 5}
                onClick={() => set("reminders", on ? f.reminders.filter((x) => x !== m) : [...f.reminders, m].sort((a, b) => a - b))}
                className={cn(
                  "text-small h-7 rounded-full px-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
                  on ? "bg-secondary text-secondary-foreground" : "bg-field text-muted-foreground hover:text-foreground",
                )}
              >
                {reminderLabel(m)}
              </button>
            )
          })}
        </div>
        <p className="text-caption text-muted-foreground">Calendar apps subscribed to your feed show these alerts.</p>
      </fieldset>

      <Field label="Notes" htmlFor="ev-notes">
        <Textarea id="ev-notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} maxLength={10_000} className="min-h-20" />
      </Field>

      {error && (
        <p role="alert" className="text-caption rounded-lg bg-error-surface px-2 py-1.5 text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="items-center">
        {state.mode === "edit" && (
          <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => onDelete(state.id, f.title)}>
            <Trash2 />
            Delete
          </Button>
        )}
        <Button type="submit" disabled={pending || !f.title.trim()}>
          {state.mode === "edit" ? "Save changes" : "Add event"}
        </Button>
      </DialogFooter>
    </form>
  )
}
