"use client"

import { useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Field, fieldClass } from "@/components/editor-fields"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { EVERY_DAY, hasDay, toggleDay, WEEKDAY_SHORT, WEEKDAYS, WEEKENDS } from "../lib/days"
import type { Habit } from "../schema"
import { createHabit, updateHabit } from "../server-actions"

const PRESETS = [
  { label: "Every day", mask: EVERY_DAY },
  { label: "Weekdays", mask: WEEKDAYS },
  { label: "Weekends", mask: WEEKENDS },
]

/** New or edit habit, in the shared bottom sheet. */
export function HabitSheet({ open, habit, onClose }: { open: boolean; habit: Habit | null; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={habit ? "Edit habit" : "New habit"} className="sm:max-w-lg">
      <div className="p-4">{open && <HabitForm key={habit?.id ?? "new"} habit={habit} onDone={onClose} />}</div>
    </Sheet>
  )
}

function HabitForm({ habit, onDone }: { habit: Habit | null; onDone: () => void }) {
  const [name, setName] = useState(habit?.name ?? "")
  const [emoji, setEmoji] = useState(habit?.emoji ?? "")
  const [weekdays, setWeekdays] = useState(habit?.weekdays ?? EVERY_DAY)
  const [reminder, setReminder] = useState(habit?.reminderTime ?? "")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return setError("Give the habit a name.")
    if (weekdays === 0) return setError("Pick at least one day.")
    const payload = { name, emoji, weekdays, reminderTime: reminder || null }
    start(async () => {
      const result = habit ? await updateHabit({ id: habit.id, ...payload }) : await createHabit(payload)
      if (!result.ok) return setError(result.error)
      toast.success(habit ? "Habit saved" : "Habit added")
      onDone()
    })
  }

  return (
    <form onSubmit={submit} className="grid gap-4" aria-label={habit ? "Edit habit" : "New habit"}>
      <div className="grid grid-cols-[4.5rem_1fr] gap-3">
        <Field label="Emoji">
          {(id) => (
            <Input
              id={id}
              value={emoji}
              onChange={(e) => setEmoji(e.target.value)}
              maxLength={16}
              placeholder="📚"
              autoComplete="off"
              className="text-center text-base"
            />
          )}
        </Field>
        <Field label="Name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              required
              placeholder="e.g. Read 20 minutes"
              autoFocus={!habit}
              autoComplete="off"
              className="text-base md:text-sm"
            />
          )}
        </Field>
      </div>

      <fieldset className="grid gap-2">
        <legend className="text-small mb-1.5 text-muted-foreground">Days</legend>
        <div className="flex gap-1.5" role="group" aria-label="Weekdays">
          {WEEKDAY_SHORT.map((day, i) => {
            const on = hasDay(weekdays, i)
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => setWeekdays((mask) => toggleDay(mask, i))}
                className={cn(
                  "text-small h-11 min-w-0 flex-1 rounded-lg border outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9",
                  on ? "border-primary bg-primary text-primary-foreground" : "border-field-border bg-field text-muted-foreground hover:text-foreground",
                )}
              >
                {day}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setWeekdays(preset.mask)}
              className={cn(
                "text-caption rounded-full px-2.5 py-1 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
                weekdays === preset.mask ? "bg-accent-500/15 text-text-accent" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </fieldset>

      <Field label="Reminder (optional)" hint="osbot reminds you in Telegram at this time if it isn't done yet.">
        {(id) => (
          <div className="flex items-center gap-2">
            <input
              id={id}
              type="time"
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
              className={cn(fieldClass, "w-32 tabular-nums dark:[color-scheme:dark]")}
            />
            {reminder && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setReminder("")}>
                No reminder
              </Button>
            )}
          </div>
        )}
      </Field>

      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {habit ? "Save" : "Add habit"}
        </Button>
      </div>
    </form>
  )
}
