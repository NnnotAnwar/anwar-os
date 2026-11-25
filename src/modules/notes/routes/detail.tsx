import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { NoteEditor } from "../components/note-editor"
import { Page } from "@/components/motion"

// One database read per request, shared by the tab title and the editor.
const getNote = cache(async (id: string) =>
  z.uuid().safeParse(id).success ? actions.get.handler({ id }) : null,
)

export async function generateMetadata({ params }: PageProps<"/app/notes/[id]">): Promise<Metadata> {
  const note = await getNote((await params).id)
  return { title: note?.title ?? "Note not found" }
}

export default function NoteDetailPage({ params }: PageProps<"/app/notes/[id]">) {
  return (
    <Page>
      <Suspense fallback={<EditorSkeleton />}>
        <NoteLoader params={params} />
      </Suspense>
    </Page>
  )
}

async function NoteLoader({ params }: Pick<PageProps<"/app/notes/[id]">, "params">) {
  const { id } = await params
  const [viewer, note] = await Promise.all([requireViewer(), getNote(id)])
  if (!note) notFound()

  return (
    <NoteEditor
      // Remount when navigating between notes so editor state never leaks across.
      key={note.id}
      mode="edit"
      id={note.id}
      initialTitle={note.title}
      initialBody={note.body}
      initialPinned={note.pinned}
      initialUpdatedAt={note.updated_at}
      initialPublishing={{ isPublic: note.isPublic, slug: note.slug, excerpt: note.excerpt, publishedAt: note.publishedAt }}
      timezone={viewer.timezone}
      locale={viewer.locale}
    />
  )
}

export function EditorSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-6" aria-hidden>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-9 w-2/3" />
      <div className="grid gap-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}
