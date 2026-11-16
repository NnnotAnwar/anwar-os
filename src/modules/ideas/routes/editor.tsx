import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { IdeaEditor } from "../components/idea-editor"

const getIdea = cache(async (id: string) => (z.uuid().safeParse(id).success ? actions.get.handler({ id }) : null))

export async function generateMetadata({ params }: PageProps<"/app/ideas/[id]">): Promise<Metadata> {
  const idea = await getIdea((await params).id)
  return { title: idea?.title ?? "Idea not found" }
}

export default function IdeaDetailPage({ params }: PageProps<"/app/ideas/[id]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <Loader params={params} />
    </Suspense>
  )
}

async function Loader({ params }: Pick<PageProps<"/app/ideas/[id]">, "params">) {
  const { id } = await params
  const [viewer, idea] = await Promise.all([requireViewer(), getIdea(id)])
  if (!idea) notFound()
  return <IdeaEditor key={idea.id} idea={idea} timezone={viewer.timezone} locale={viewer.locale} />
}

export function NewIdeaPage() {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <NewIdea />
    </Suspense>
  )
}

async function NewIdea() {
  const viewer = await requireViewer()
  return <IdeaEditor idea={null} timezone={viewer.timezone} locale={viewer.locale} />
}

function EditorSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" aria-hidden>
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-96 rounded-xl" />
    </div>
  )
}
