import { Suspense } from "react"
import { notFound } from "next/navigation"
import { z } from "zod"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { DocumentEditor } from "../components/document-editor"
import { DocumentSkeleton } from "./document"
import { Page } from "@/components/motion"

export default function NewDocumentPage({ searchParams }: PageProps<"/app/files/doc/new">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-3">
        <Suspense fallback={<DocumentSkeleton />}>
          <NewDocument searchParams={searchParams} />
        </Suspense>
      </div>
    </Page>
  )
}

async function NewDocument({ searchParams }: Pick<PageProps<"/app/files/doc/new">, "searchParams">) {
  const { folder } = await searchParams
  const viewer = await requireViewer()
  let folderId: string | null = null
  let path: Awaited<ReturnType<typeof actions.listFolder.handler>> = null
  if (typeof folder === "string" && z.uuid().safeParse(folder).success) {
    path = await actions.listFolder.handler({ folderId: folder })
    if (!path) notFound()
    folderId = folder
  }
  return (
    <>
      <DocumentEditor path={path?.path ?? []} mode="create" folderId={folderId} timezone={viewer.timezone} locale={viewer.locale} />
    </>
  )
}
