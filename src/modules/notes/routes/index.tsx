import { Suspense } from "react"
import Link from "next/link"
import { NotePencilDuo, Plus } from "@/components/icons"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PendingItems } from "@/components/offline/pending-items"
import { EmptyState } from "@/components/list/shortcut-hint"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { NotesBrowser } from "../components/notes-browser"

export default function NotesPage({ searchParams }: PageProps<"/app/notes">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-6">
        <PageHeader
          title="Notes"
          actions={
            <Link href="/app/notes/new" className={buttonVariants({ size: "lg" })}>
              <Plus />
              New note
            </Link>
          }
        />
        <PendingItems kinds={["note"]} />
        <Suspense
          fallback={
            <SkeletonExit>
              <NotesSkeleton />
            </SkeletonExit>
          }
        >
          <NotesBody searchParams={searchParams} />
        </Suspense>
      </div>
    </Page>
  )
}

async function NotesBody({ searchParams }: Pick<PageProps<"/app/notes">, "searchParams">) {
  const { q } = await searchParams
  const query = typeof q === "string" ? q.trim().slice(0, 100) : ""
  const viewer = await requireViewer()
  const notes = await actions.list.handler({ limit: 200, query: query || undefined })

  if (!query && notes.length === 0) {
    return (
      <Reveal>
        <EmptyState
          icon={NotePencilDuo}
          title="Your notes will live here"
          action={
            <Link href="/app/notes/new" className={buttonVariants({ size: "lg" })}>
              <Plus />
              Write the first note
            </Link>
          }
        >
          Ideas, meeting notes, shopping lists — pin the important ones and they show up on Today.
        </EmptyState>
      </Reveal>
    )
  }

  return (
    <Reveal>
      <NotesBrowser notes={notes} query={query} locale={viewer.locale} now={new Date().toISOString()} />
    </Reveal>
  )
}

/** Mirrors the loaded list: filter row, a section label, two-line rows. */
function NotesSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-16 rounded-lg" />
      </div>
      <Skeleton className="h-3 w-20" />
      <div className="glass grid divide-y divide-hairline overflow-hidden rounded-xl">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  )
}
