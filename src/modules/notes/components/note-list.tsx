import Link from "next/link"
import { Pin } from "lucide-react"
import { formatRelative } from "@/lib/time"
import { excerpt, type Note } from "../schema"

/** Dense, scannable rows: title and preview on the left, last edit on the right. */
export function NoteList({
  notes,
  locale,
  now,
  query,
}: {
  notes: Note[]
  locale: string
  now: Date
  query?: string
}) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {notes.map((note) => {
        const preview = excerpt(note.body, query)
        return (
          <li key={note.id}>
            <Link
              href={`/app/notes/${note.id}`}
              className="group flex items-baseline gap-4 px-4 py-3 outline-none hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            >
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="flex items-center gap-1.5 font-medium">
                  {note.pinned && <Pin className="size-3.5 shrink-0 text-sky" aria-label="Pinned" />}
                  <span className="truncate">{note.title}</span>
                </span>
                {preview && <span className="truncate text-sm text-muted-foreground">{preview}</span>}
              </span>
              <time
                dateTime={note.updated_at}
                className="shrink-0 font-mono text-xs text-muted-foreground tabular"
              >
                {formatRelative(new Date(note.updated_at), now, locale)}
              </time>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
