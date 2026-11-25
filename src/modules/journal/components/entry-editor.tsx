"use client"

import { useId, useState, useTransition, type FormEvent } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { moodOf, TEXT_MAX, type EntrySnapshot, type JournalEntry, type Mood } from "../schema"
import { saveJournalEntry } from "../server-actions"
import { MoodPicker } from "./mood-picker"

/**
 * A day's mood and line. A face saves in one tap; the line saves with Enter or
 * Save. Each save offers Undo, which writes the previous version back.
 */
export function EntryEditor({
  day,
  entry,
  dayLabel,
  compact = false,
  autoFocus = false,
  className,
}: {
  day: string
  entry: Pick<JournalEntry, "mood" | "text"> | null
  /** "today" or "Tue 24 Nov", for the toasts. */
  dayLabel: string
  compact?: boolean
  autoFocus?: boolean
  className?: string
}) {
  const id = useId()
  const [mood, setMood] = useState<Mood | null>(entry?.mood ?? null)
  const [saved, setSaved] = useState(entry?.text ?? "")
  const [text, setText] = useState(entry?.text ?? "")
  const [, start] = useTransition()
  const dirty = text.trim() !== saved

  function apply(next: Pick<JournalEntry, "mood" | "text"> | null, keepTyping = false) {
    setMood(next?.mood ?? null)
    setSaved(next?.text ?? "")
    if (!keepTyping) setText(next?.text ?? "")
  }

  function undo(previous: EntrySnapshot) {
    start(async () => {
      const result = await saveJournalEntry({ day, mood: previous?.mood ?? null, text: previous?.text ?? "" })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      apply(result.value.entry)
      toast("Put back")
    })
  }

  function saveMood(next: Mood | null) {
    const before = mood
    setMood(next)
    start(async () => {
      const result = await saveJournalEntry({ day, mood: next })
      if (!result.ok) {
        setMood(before)
        toast.error(result.error)
        return
      }
      apply(result.value.entry, true)
      const face = moodOf(next)
      toast(face ? `${face.emoji} ${face.label} · ${dayLabel}` : "Mood cleared", {
        action: { label: "Undo", onClick: () => undo(result.value.previous) },
      })
    })
  }

  function saveText(event?: FormEvent) {
    event?.preventDefault()
    if (!dirty) return
    start(async () => {
      const result = await saveJournalEntry({ day, text })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      apply(result.value.entry)
      toast(result.value.entry ? "Line saved" : "Line removed", {
        action: { label: "Undo", onClick: () => undo(result.value.previous) },
      })
    })
  }

  const left = TEXT_MAX - text.length
  return (
    <div className={cn("grid gap-3", className)}>
      <MoodPicker value={mood} onChange={saveMood} label={`Mood for ${dayLabel}`} />
      <form onSubmit={saveText} className="grid gap-1.5">
        <label htmlFor={`${id}-line`} className={cn("text-small text-muted-foreground", compact && "sr-only")}>
          One line about the day
        </label>
        <div className="flex gap-2">
          <Input
            id={`${id}-line`}
            value={text}
            onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
            maxLength={TEXT_MAX}
            placeholder={compact ? "One line about the day…" : "What stood out today?"}
            autoFocus={autoFocus}
            enterKeyHint="done"
            autoComplete="off"
            className="h-11 md:h-9"
          />
          <Button type="submit" size="lg" disabled={!dirty} className="h-11 shrink-0 px-3 md:h-9">
            Save
          </Button>
        </div>
        {left <= 60 && (
          <p className="text-caption text-muted-foreground tabular-nums" aria-live="polite">
            {left} characters left
          </p>
        )}
      </form>
    </div>
  )
}
