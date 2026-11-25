import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { FeedbackDetail } from "../components/feedback-detail"
import { kindLabels } from "../schema"
import { Page } from "@/components/motion"

const getItem = cache(async (id: string) => (z.uuid().safeParse(id).success ? actions.get.handler({ id }) : null))

export async function generateMetadata({ params }: PageProps<"/app/feedback/[id]">): Promise<Metadata> {
  const item = await getItem((await params).id)
  return { title: item ? `${kindLabels[item.kind]} from ${item.name || "anonymous"}` : "Feedback not found" }
}

export default function FeedbackDetailPage({ params }: PageProps<"/app/feedback/[id]">) {
  return (
    <Page>
      <Suspense fallback={<DetailSkeleton />}>
        <Loader params={params} />
      </Suspense>
    </Page>
  )
}

async function Loader({ params }: Pick<PageProps<"/app/feedback/[id]">, "params">) {
  const { id } = await params
  const [viewer, item] = await Promise.all([requireViewer(), getItem(id)])
  if (!item) notFound()
  return <FeedbackDetail key={item.id} item={item} timezone={viewer.timezone} locale={viewer.locale} />
}

function DetailSkeleton() {
  return (
    <div className="grid w-full max-w-3xl gap-3" aria-hidden>
      <Skeleton className="h-8 w-28" />
      <div className="glass grid gap-3 rounded-xl p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  )
}
