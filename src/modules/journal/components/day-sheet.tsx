"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { toast } from "sonner"
import { Trash2 } from "@/components/icons"
import { Sheet } from "@/components/sheet"
import { Button } from "@/components/ui/button"
import type { JournalEntry } from "../schema"
import { deleteJournalEntry, saveJournalEntry } from "../server-actions"
import { EntryEditor } from "./entry-editor"

/** Any day's entry (from the heat-map, the list or search), in a sheet: edit, or delete with Undo. */
export function DaySheet({
  day,
  label,
  entry,
  future,
  closeHref,
}: {
  day: string
  label: string
  entry: JournalEntry | null
  future: boolean
  closeHref: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const close = () => router.replace(closeHref, { scroll: false })

  return (
    <Sheet open onOpenChange={(open) => !open && close()} title={label} description={future ? "This day hasn't come yet." : "A face and one line. Each saves on its own."}>
      <div className="grid gap-4 p-4">
        {future ? (
          <p className="text-meta text-muted-foreground">Come back that evening.</p>
        ) : (
          <EntryEditor key={day} day={day} entry={entry} dayLabel={label} autoFocus={!entry} />
        )}
        <div className="flex items-center justify-between gap-2">
          {entry ? (
            <Button
              variant="destructive"
              size="lg"
              disabled={pending}
              className="h-11 md:h-9"
              onClick={() =>
                start(async () => {
                  const result = await deleteJournalEntry({ day })
                  if (!result.ok) {
                    toast.error(result.error)
                    return
                  }
                  const previous = result.value.previous
                  close()
                  toast(`Deleted ${label}`, {
                    action: previous
                      ? { label: "Undo", onClick: () => void saveJournalEntry({ day, mood: previous.mood, text: previous.text }) }
                      : undefined,
                  })
                })
              }
            >
              <Trash2 />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button variant="ghost" size="lg" className="h-11 md:h-9" onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
