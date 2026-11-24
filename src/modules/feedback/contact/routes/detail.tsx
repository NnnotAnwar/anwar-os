import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../../actions"
import { ContactDetail } from "../components/contact-detail"
import { topicLabels } from "../schema"

const getMessage = cache(async (id: string) =>
  z.uuid().safeParse(id).success ? actions.contactGet.handler({ id }) : null,
)

export async function generateMetadata({ params }: PageProps<"/app/feedback/contact/[id]">): Promise<Metadata> {
  const message = await getMessage((await params).id)
  return { title: message ? `${topicLabels[message.topic]} from ${message.name}` : "Message not found" }
}

export default function ContactDetailPage({ params }: PageProps<"/app/feedback/contact/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Loader params={params} />
    </Suspense>
  )
}

async function Loader({ params }: Pick<PageProps<"/app/feedback/contact/[id]">, "params">) {
  const { id } = await params
  const [viewer, message] = await Promise.all([requireViewer(), getMessage(id)])
  if (!message) notFound()
  return <ContactDetail key={message.id} message={message} timezone={viewer.timezone} locale={viewer.locale} />
}

function DetailSkeleton() {
  return (
    <div className="grid w-full max-w-3xl gap-3" aria-hidden>
      <Skeleton className="h-8 w-28" />
      <div className="glass grid gap-3 rounded-xl p-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}
