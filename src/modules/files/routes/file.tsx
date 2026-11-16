import { cache, Suspense } from "react"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { Breadcrumbs } from "../components/breadcrumbs"
import { FileDetails } from "../components/file-details"
import { ItemIcon } from "../components/file-type-icon"
import { rawHref } from "../lib/links"
import { formatBytes, previewKind } from "../lib/validation"

const getFile = cache(async (id: string) => (z.uuid().safeParse(id).success ? actions.getFile.handler({ id }) : null))

export async function generateMetadata({ params }: PageProps<"/app/files/file/[id]">): Promise<Metadata> {
  const file = await getFile((await params).id)
  return { title: file?.name ?? "File not found" }
}

export default function FilePage({ params }: PageProps<"/app/files/file/[id]">) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <Suspense fallback={<FileSkeleton />}>
        <FileLoader params={params} />
      </Suspense>
    </div>
  )
}

async function FileLoader({ params }: Pick<PageProps<"/app/files/file/[id]">, "params">) {
  const { id } = await params
  const [viewer, file] = await Promise.all([requireViewer(), getFile(id)])
  if (!file) notFound()
  const kind = previewKind(file.mime)
  const added = new Intl.DateTimeFormat(viewer.locale === "en" ? "en-GB" : viewer.locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: viewer.timezone,
  }).format(new Date(file.createdAt))

  return (
    <>
      <Breadcrumbs path={file.path} current={file.name} />
      <PageHeader eyebrow="File" title={file.name} meta={`${formatBytes(file.size)} · added ${added}`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-label="Preview" className="glass grid min-h-64 place-items-center overflow-hidden rounded-xl p-2">
          {kind === "image" ? (
            // A presigned redirect; next/image can't optimise private, short-lived URLs.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={rawHref(file.id, "inline")} alt={file.description || file.name} className="max-h-[70vh] w-auto rounded-lg object-contain" />
          ) : kind === "pdf" ? (
            <iframe src={rawHref(file.id, "inline")} title={`Preview of ${file.name}`} className="h-[70vh] w-full rounded-lg bg-white" />
          ) : (
            <div className="grid justify-items-center gap-2 p-8 text-center">
              <ItemIcon item={file} className="size-12 [&_svg]:size-6" />
              <p className="text-meta text-muted-foreground">No preview for this type. Download it to open.</p>
            </div>
          )}
        </section>
        <FileDetails file={file} />
      </div>
    </>
  )
}

function FileSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-7 w-64" />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Skeleton className="h-96 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}
