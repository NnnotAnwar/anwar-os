import { Suspense } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { IdCard } from "@/components/icons"
import { NAV_FORWARD, Page, Reveal, SkeletonExit } from "@/components/motion"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { CvSheet } from "../components/cv-sheet"
import { PrintButton } from "../components/print-button"
import { getPublicCv } from "../public"
import "../print.css"

export default function PublicCvPage() {
  return (
    <Page>
      <Suspense
        fallback={
          <SkeletonExit>
            <SheetSkeleton />
          </SkeletonExit>
        }
      >
        <Reveal>
          <Resume />
        </Reveal>
      </Suspense>
    </Page>
  )
}

async function Resume() {
  // Request time only (no database at build); the read itself is cached.
  await connection()
  const cv = await getPublicCv()
  if (!cv) return <NotPublished />
  return <CvSheet cv={cv} actions={<PrintButton />} />
}

function NotPublished() {
  return (
    <div className="glass mx-auto grid w-full max-w-3xl justify-items-start gap-3 rounded-xl p-6">
      <IdCard className="size-6 text-text-accent" />
      <div className="grid gap-1">
        <h1 className="text-card-title">The CV isn’t public yet</h1>
        <p className="text-meta text-muted-foreground">In the meantime, the projects show what I build.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/projects" transitionTypes={NAV_FORWARD} className={buttonVariants({ size: "lg" })}>
          See projects
        </Link>
        <Link href="/feedback" transitionTypes={NAV_FORWARD} className={buttonVariants({ variant: "outline", size: "lg" })}>
          Send a message
        </Link>
      </div>
    </div>
  )
}

function SheetSkeleton() {
  return (
    <div className="glass mx-auto grid w-full max-w-3xl gap-6 rounded-xl p-8" aria-hidden>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}
