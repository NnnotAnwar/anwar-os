import { Suspense } from "react"
import Link from "next/link"
import { NotebookPen, Plus } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { NoteList } from "../components/note-list"
import { NotesSearch } from "../components/notes-search"

export default function NotesPage({ searchParams }: PageProps<"/app/notes">) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader title="Notes" />
      <Suspense fallback={<NotesSkeleton />}>
        <NotesBody searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function NotesBody({ searchParams }: Pick<PageProps<"/app/notes">, "searchParams">) {
  const { q } = await searchParams
  const query = typeof q === "string" ? q.trim().slice(0, 100) : ""
  const viewer = await requireViewer()
  const notes = await actions.list.handler({ limit: 200, query: query || undefined })
  const now = new Date()

  const pinned = query ? [] : notes.filter((n) => n.pinned)
  const rest = query ? notes : notes.filter((n) => !n.pinned)

  if (!query && notes.length === 0) return <EmptyState />

  return (
    <div className="grid gap-6">
      <NotesSearch initialQuery={query} />
      {query && (
        <p className="font-mono text-xs text-muted-foreground" role="status">
          {notes.length === 0
            ? `Nothing matches “${query}”. Try fewer words.`
            : `${notes.length} ${notes.length === 1 ? "note matches" : "notes match"} “${query}”`}
        </p>
      )}
      {pinned.length > 0 && (
        <section className="grid gap-2" aria-labelledby="pinned-heading">
          <h2 id="pinned-heading" className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            Pinned
          </h2>
          <NoteList notes={pinned} locale={viewer.locale} now={now} />
        </section>
      )}
      {rest.length > 0 && (
        <section className="grid gap-2" aria-labelledby="all-heading">
          {pinned.length > 0 && (
            <h2 id="all-heading" className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
              Everything else · {rest.length}
            </h2>
          )}
          <NoteList notes={rest} locale={viewer.locale} now={now} query={query || undefined} />
        </section>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="grid justify-items-start gap-4 rounded-xl border border-dashed p-8">
      <NotebookPen className="size-6 text-text-accent" aria-hidden />
      <div className="grid gap-1">
        <p className="font-medium">Your notes will live here</p>
        <p className="max-w-prose text-sm text-muted-foreground">
          Ideas, meeting notes, things to remember. Pin the important ones and they show up on Today.
        </p>
      </div>
      <Link href="/app/notes/new" className={buttonVariants()}>
        <Plus />
        Write the first note
      </Link>
    </div>
  )
}

function NotesSkeleton() {
  return (
    <div className="grid gap-6" aria-hidden>
      <Skeleton className="h-10 w-full" />
      <div className="grid gap-px overflow-hidden rounded-xl border">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="grid gap-2 bg-card px-4 py-3.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3.5 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
}
