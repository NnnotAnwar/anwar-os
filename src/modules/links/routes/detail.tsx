import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { actions } from "../actions"
import { LinkEditor } from "../components/link-editor"

const getLink = cache(async (id: string) => (z.uuid().safeParse(id).success ? actions.get.handler({ id }) : null))

export async function generateMetadata({ params }: PageProps<"/app/links/[id]">): Promise<Metadata> {
  const link = await getLink((await params).id)
  return { title: link?.title ?? "Link not found" }
}

export default function LinkDetailPage({ params }: PageProps<"/app/links/[id]">) {
  return (
    <Suspense fallback={<EditorSkeleton />}>
      <LinkLoader params={params} />
    </Suspense>
  )
}

async function LinkLoader({ params }: Pick<PageProps<"/app/links/[id]">, "params">) {
  const link = await getLink((await params).id)
  if (!link) notFound()
  return <LinkEditor key={link.id} link={link} />
}

function EditorSkeleton() {
  return (
    <div className="grid w-full max-w-2xl gap-3" aria-hidden>
      <Skeleton className="h-8 w-24" />
      <div className="glass grid gap-4 rounded-xl p-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="grid gap-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
