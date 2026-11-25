import { Suspense } from "react"
import Link from "next/link"
import { Bell, Plus, Stamp } from "@/components/icons"
import { NAV_FORWARD, Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { DocumentsList } from "../components/documents-list"
import { needsAttention } from "../lib/status"

export default function DocumentsPage() {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <Suspense
          fallback={
            <SkeletonExit>
              <ListSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Documents />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

async function Documents() {
  const { documents } = await actions.list.handler({ limit: 200 })
  const attention = documents.filter((doc) => needsAttention(doc.status)).length

  return (
    <div className="grid gap-4">
      <PageHeader
        eyebrow="Paperwork"
        title="Documents"
        meta={documents.length > 0 ? (attention > 0 ? `${attention} need${attention === 1 ? "s" : ""} attention` : `${documents.length}`) : undefined}
        description={documents.length > 0 ? "Soonest expiry first. osbot reminds you in Telegram before each one runs out." : undefined}
        actions={
          documents.length > 0 ? (
            <Link href="/app/documents/new" transitionTypes={NAV_FORWARD} className={cn(buttonVariants({ size: "lg" }), "h-11 md:h-9")}>
              <Plus />
              New document
            </Link>
          ) : undefined
        }
      />
      {documents.length > 0 ? <DocumentsList documents={documents} /> : <Empty />}
    </div>
  )
}

function Empty() {
  return (
    <section className="glass grid justify-items-start gap-3 rounded-xl p-6 [--glass-shadow:var(--shadow-glass-lg)]">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-xl bg-secondary text-text-accent">
        <Stamp className="size-6" />
      </span>
      <h2 className="text-card-title">Keep track of your documents</h2>
      <p className="text-meta max-w-prose text-muted-foreground">
        Passport, residence permit, health insurance: add the expiry date and a scan. osbot reminds you in Telegram 90, 30 and 7 days
        ahead and on the day, so a renewal never sneaks up on you.
      </p>
      <Link href="/app/documents/new" transitionTypes={NAV_FORWARD} className={cn(buttonVariants({ size: "lg" }), "h-11 md:h-9")}>
        <Plus />
        Add your first document
      </Link>
      <p className="text-caption flex items-center gap-1.5 text-muted-foreground">
        <Bell className="size-3.5" />
        Private: only you see them. No document numbers are stored.
      </p>
    </section>
  )
}

function ListSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-16 w-56" />
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 rounded-xl" />
      ))}
    </div>
  )
}
