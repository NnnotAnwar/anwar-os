"use client"

import { forwardRef, useMemo, useState, useTransition } from "react"
import { CalendarDays, Clock, ListBullets, Plus, Repeat } from "@/components/icons"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { parseIsoDate } from "@/modules/calendar/lib/zoned"
import { dueLabel, isoFromLocal, repeatLabel } from "../lib/format"
import { parseTask } from "../lib/parse"
import type { Task } from "../schema"
import { quickAddTask } from "../server-actions"

/**
 * One line to add a task in plain words. What the parser understood shows
 * as chips under the field while you type, so there are no surprises.
 */
export const QuickAdd = forwardRef<
  HTMLInputElement,
  {
    today: string
    locale: string
    listNames: string[]
    listId: string | null
    dueToday: boolean
    placeholder?: string
    onAdded: (task: Task) => void
  }
>(function QuickAdd({ today, locale, listNames, listId, dueToday, placeholder, onAdded }, ref) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const parsed = useMemo(
    () => (text.trim() ? parseTask(text, parseIsoDate(today)!, listNames) : null),
    [text, today, listNames],
  )
  const dueIso = parsed?.dueDate ? isoFromLocal(parsed.dueDate) : dueToday && parsed ? today : null

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = text.trim()
    if (!value) {
      setError("Write the task first — a few words are enough.")
      return
    }
    startTransition(async () => {
      const result = await quickAddTask({ text: value, listId, dueToday })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setText("")
      setError(null)
      onAdded(result.value)
    })
  }

  const chips: { key: string; icon: React.ReactNode; text: string; accent?: boolean }[] = []
  if (parsed) {
    if (dueIso) {
      const due = dueLabel(dueIso, today, locale)
      const time = parsed.dueTime
        ? ` ${String(parsed.dueTime.hour).padStart(2, "0")}:${String(parsed.dueTime.minute).padStart(2, "0")}`
        : ""
      chips.push({ key: "due", icon: parsed.dueTime ? <Clock /> : <CalendarDays />, text: `${due.text}${time}` })
    }
    if (parsed.repeat) chips.push({ key: "repeat", icon: <Repeat />, text: repeatLabel(parsed.rrule, locale) ?? "Repeats" })
    if (parsed.priority !== "none")
      chips.push({ key: "priority", icon: null, text: parsed.priority === "high" ? "!! High" : "! Low", accent: parsed.priority === "high" })
    if (parsed.list)
      chips.push({ key: "list", icon: <ListBullets />, text: parsed.listExists ? parsed.list : `New list “${parsed.list}”` })
  }

  return (
    <form onSubmit={submit} className="glass grid gap-2 rounded-xl p-2.5" aria-label="Add a task">
      <div className="flex items-center gap-2">
        <span aria-hidden className="ml-1.5 flex size-5 shrink-0 rounded-full border-[1.5px] border-dashed border-muted-foreground/40" />
        <label htmlFor="quick-task" className="sr-only">
          New task
        </label>
        <input
          ref={ref}
          id="quick-task"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setText("")
              e.currentTarget.blur()
            }
          }}
          placeholder={placeholder ?? "e.g. Call the bank tomorrow 10:00 !high #University"}
          maxLength={500}
          autoComplete="off"
          enterKeyHint="done"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "quick-task-error" : "quick-task-preview"}
          className="text-body h-10 min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground/80"
        />
        <Button type="submit" size="lg" disabled={pending || !text.trim()} className="shrink-0">
          <Plus />
          <span className="max-sm:sr-only">Add</span>
        </Button>
      </div>
      {error ? (
        <p id="quick-task-error" className="text-caption px-1.5 text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <div id="quick-task-preview" aria-live="polite" className={cn("flex min-h-0 flex-wrap gap-1.5 px-1", !chips.length && "sr-only")}>
          {chips.length > 0 && <span className="sr-only">Will be added with:</span>}
          {chips.map((c) => (
            <span
              key={c.key}
              className={cn(
                "text-caption inline-flex h-6 items-center gap-1 rounded-md bg-accent-500/10 px-2 font-semibold text-text-accent [&_svg]:size-3",
                !c.accent && c.key === "priority" && "bg-track text-muted-foreground",
              )}
            >
              {c.icon}
              {c.text}
            </span>
          ))}
        </div>
      )}
    </form>
  )
})
