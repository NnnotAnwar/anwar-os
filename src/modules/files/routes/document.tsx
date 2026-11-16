import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { Breadcrumbs } from "../components/breadcrumbs"
import { DocumentEditor } from "../components/document-editor"

const getDocument = cache(async (id: string) =>
  z.uuid().safeParse(id).success ? actions.getDocument.handler({ id }) : null,
)

export async function generateMetadata({ params }: PageProps<"/app/files/doc/[id]">): Promise<Metadata> {
  const doc = await getDocument((await params).id)
  return { title: doc?.title ?? "Document not found" }
}

export default function DocumentPage({ params }: PageProps<"/app/files/doc/[id]">) {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3">
      <Suspense fallback={<DocumentSkeleton />}>
        <DocumentLoader params={params} />
      </Suspense>
    </div>
  )
}

async function DocumentLoader({ params }: Pick<PageProps<"/app/files/doc/[id]">, "params">) {
  const { id } = await params
  const [viewer, doc] = await Promise.all([requireViewer(), getDocument(id)])
  if (!doc) notFound()
  return (
    <>
      <Breadcrumbs path={doc.path} current={doc.title} />
      <DocumentEditor
        key={doc.id}
        mode="edit"
        id={doc.id}
        folderId={doc.folderId}
        initialTitle={doc.title}
        initialBody={doc.body}
        initialUpdatedAt={doc.updatedAt}
        timezone={viewer.timezone}
        locale={viewer.locale}
      />
    </>
  )
}

export function DocumentSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      <Skeleton className="h-4 w-40" />
      <div className="glass grid gap-4 rounded-xl p-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
      </div>
    </div>
  )
}
