"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Pencil, Trash2 } from "@/components/icons"
import { cn } from "@/lib/utils"
import { formatDayShort } from "../lib/format"
import { moodOf, type JournalEntry } from "../schema"
import { deleteJournalEntry, saveJournalEntry } from "../server-actions"

const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:size-9 [&_svg]:size-4"

/** Past entries, newest first: a tap opens the day; delete acts at once with Undo. */
export function EntryList({ entries, year, dayHref }: { entries: JournalEntry[]; year: number; dayHref: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [, start] = useTransition()

  function remove(entry: JournalEntry) {
    const label = formatDayShort(entry.day, year)
    setHidden((h) => new Set(h).add(entry.day))
    start(async () => {
      const result = await deleteJournalEntry({ day: entry.day })
      if (!result.ok) {
        setHidden((h) => {
          const next = new Set(h)
          next.delete(entry.day)
          return next
        })
        toast.error(result.error)
        return
      }
      toast(`Deleted ${label}`, {
        action: {
          label: "Undo",
          onClick: () =>
            void saveJournalEntry({ day: entry.day, mood: entry.mood, text: entry.text }).then((r) => {
              if (!r.ok) toast.error(r.error)
              setHidden((h) => {
                const next = new Set(h)
                next.delete(entry.day)
                return next
              })
            }),
        },
      })
    })
  }

  const shown = entries.filter((e) => !hidden.has(e.day))
  if (!shown.length) return null
  return (
    <ul className="grid gap-px overflow-hidden rounded-lg" aria-label="Entries">
      {shown.map((entry) => {
        const mood = moodOf(entry.mood)
        const label = formatDayShort(entry.day, year)
        const href = dayHref.replace("__DAY__", entry.day)
        return (
          <li key={entry.day} className="flex items-center gap-2 bg-card/40 py-1 pr-1 pl-3">
            <span className="grid size-8 shrink-0 place-items-center text-xl" title={mood?.label ?? "No mood"}>
              <span aria-hidden>{mood?.emoji ?? "·"}</span>
              <span className="sr-only">{mood ? mood.label : "No mood"}</span>
            </span>
            <Link
              href={href}
              scroll={false}
              className="grid min-w-0 flex-1 gap-0.5 rounded py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="text-caption text-muted-foreground tabular-nums">{label}</span>
              <span className={cn("text-body line-clamp-2 break-words", !entry.text && "text-muted-foreground italic")}>
                {entry.text || "No line, just the mood"}
              </span>
            </Link>
            <Link href={href} scroll={false} className={iconButton} aria-label={`Edit ${label}`} title="Edit">
              <Pencil />
            </Link>
            <button type="button" className={iconButton} aria-label={`Delete ${label}`} title="Delete" onClick={() => remove(entry)}>
              <Trash2 />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
