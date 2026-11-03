import Link from "next/link"
import { Pin } from "lucide-react"
import type { ViewerContext } from "@/core/module"
import { formatRelative } from "@/lib/time"
import { actions } from "../actions"
import { excerpt } from "../schema"

const rowClass =
  "flex items-baseline gap-3 rounded-md px-2 py-1.5 -mx-2 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"

export async function PinnedNotes() {
  const notes = await actions.list.handler({ pinned: true, limit: 6 })
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Pin a note with <Pin className="inline size-3.5 align-[-2px]" aria-label="the pin button" /> and it
        stays here.
      </p>
    )
  }
  return (
    <ul className="grid gap-0.5">
      {notes.map((note) => (
        <li key={note.id}>
          <Link href={`/app/notes/${note.id}`} className={rowClass}>
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-sm font-medium">{note.title}</span>
              {note.body && (
                <span className="truncate text-xs text-muted-foreground">{excerpt(note.body, undefined, 90)}</span>
              )}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export async function RecentNotes({ ctx }: { ctx: ViewerContext }) {
  const notes = await actions.list.handler({ pinned: false, limit: 6 })
  if (notes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing written yet.{" "}
        <Link href="/app/notes/new" className="text-sky underline-offset-4 hover:underline">
          Start a note
        </Link>
      </p>
    )
  }
  const now = new Date()
  return (
    <ul className="grid gap-0.5">
      {notes.map((note) => (
        <li key={note.id}>
          <Link href={`/app/notes/${note.id}`} className={rowClass}>
            <span className="min-w-0 flex-1 truncate text-sm">{note.title}</span>
            <time dateTime={note.updated_at} className="shrink-0 font-mono text-[11px] text-muted-foreground tabular">
              {formatRelative(new Date(note.updated_at), now, ctx.locale)}
            </time>
          </Link>
        </li>
      ))}
    </ul>
  )
}
