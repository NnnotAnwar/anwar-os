import { Suspense } from "react"
import Link from "next/link"
import { ArrowUpRight } from "@/components/icons"
import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { CvEditor } from "../components/cv-editor"
import { Page } from "@/components/motion"

export default function CvPage() {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-4 xl:max-w-none">
        <PageHeader
          eyebrow="Résumé"
          title="CV"
          description="Everything saves as you type. Publish it to show it on /cv; the eye hides single entries, the grip reorders them."
          actions={
            <Link href="/cv" target="_blank" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Public page
              <ArrowUpRight />
            </Link>
          }
        />
        <Suspense fallback={<EditorSkeleton />}>
          <Editor />
        </Suspense>
      </div>
    </Page>
  )
}

async function Editor() {
  const [viewer, cv] = await Promise.all([requireViewer(), actions.get.handler({})])
  return <CvEditor cv={cv} timezone={viewer.timezone} locale={viewer.locale} />
}

function EditorSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </div>
  )
}
