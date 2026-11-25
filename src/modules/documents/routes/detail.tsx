import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Page } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { actions } from "../actions"
import { DocumentForm } from "../components/document-form"
import { DocumentView } from "../components/document-view"

const getDocument = cache(async (id: string) => (z.uuid().safeParse(id).success ? actions.get.handler({ id }) : null))

export async function generateMetadata({ params }: PageProps<"/app/documents/[id]">): Promise<Metadata> {
  const document = await getDocument((await params).id)
  return { title: document?.name ?? "Document not found" }
}

/** /app/documents/<id>[?renew=1]: the document; ?renew=1 (osbot's ✓ Renewed) opens Renewed. */
export default function DocumentPage({ params, searchParams }: PageProps<"/app/documents/[id]">) {
  return (
    <Page>
      <Suspense fallback={<DetailSkeleton />}>
        <Detail params={params} searchParams={searchParams} />
      </Suspense>
    </Page>
  )
}

async function Detail({ params, searchParams }: Pick<PageProps<"/app/documents/[id]">, "params" | "searchParams">) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const document = await getDocument(id)
  if (!document) notFound()
  return <DocumentView key={document.id} document={document} renew={query.renew === "1"} />
}

export async function generateEditMetadata({ params }: PageProps<"/app/documents/[id]/edit">): Promise<Metadata> {
  const document = await getDocument((await params).id)
  return { title: document ? `Edit ${document.name}` : "Document not found" }
}

/** /app/documents/<id>/edit */
export function EditDocumentPage({ params }: PageProps<"/app/documents/[id]/edit">) {
  return (
    <Page>
      <Suspense fallback={<DetailSkeleton />}>
        <Edit params={params} />
      </Suspense>
    </Page>
  )
}

async function Edit({ params }: Pick<PageProps<"/app/documents/[id]/edit">, "params">) {
  const document = await getDocument((await params).id)
  if (!document) notFound()
  return <DocumentForm key={document.id} document={document} />
}

/** /app/documents/new */
export function NewDocumentPage() {
  return (
    <Page>
      <DocumentForm document={null} />
    </Page>
  )
}

function DetailSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4" aria-hidden>
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
    </div>
  )
}
