import { Suspense } from "react"
import { CaptureForm } from "@/components/capture/capture-form"
import { Page } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { parseShared } from "@/core/capture"

export const metadata = { title: "Capture" }

/**
 * /app/capture: the PWA share target (manifest share_target, GET with title,
 * text, url) and the "Capture" home-screen shortcut. Prefills from whatever was
 * shared; the form picks a destination and saves through the module's action.
 */
export default function CapturePage({ searchParams }: PageProps<"/app/capture">) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-2xl gap-4 md:gap-6">
        <PageHeader eyebrow="Capture" title="Save something" description="Shared from another app, or typed in a hurry." />
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <Prefilled searchParams={searchParams} />
        </Suspense>
      </div>
    </Page>
  )
}

async function Prefilled({ searchParams }: Pick<PageProps<"/app/capture">, "searchParams">) {
  const params = await searchParams
  const shared = ["title", "text", "url"].some((k) => params[k] !== undefined)
  const draft = parseShared(params)
  // A new share opens a fresh form, even if the screen was already open.
  return <CaptureForm key={JSON.stringify(draft)} initial={draft} shared={shared} />
}
