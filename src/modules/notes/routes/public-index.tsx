import { Suspense } from "react"
import Link from "next/link"
import { connection } from "next/server"
import { ArrowRight, PenNib, Rss } from "@/components/icons"
import { NAV_FORWARD, Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { readingMinutes } from "@/lib/reading"
import { cn } from "@/lib/utils"
import { formatPublished } from "../lib/dates"
import { getPublishedNotes } from "../public"
import { summaryOf } from "../schema"

export default function PublicWritingPage() {
  return (
    <Page>
      <div className="grid gap-6">
        <PageHeader
          eyebrow="Writing"
          title="Notes, written up"
          description="Things I worked out while building, studying and self-hosting — published from my own notes."
          actions={
            <a
              href="/writing/feed.xml"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }), "max-md:h-11")}
            >
              <Rss />
              RSS feed
            </a>
          }
        />
        <Suspense
          fallback={
            <SkeletonExit>
              <ListSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <Posts />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

async function Posts() {
  // Request time only: the build has no database. The read itself is cached.
  await connection()
  const notes = await getPublishedNotes()
  if (notes.length === 0) {
    return (
      <div className="glass grid justify-items-start gap-2 rounded-xl p-6">
        <PenNib className="size-6 text-text-accent" />
        <p className="text-card-title">Nothing published yet</p>
        <p className="text-meta text-muted-foreground">
          The first notes are on their way. Follow the RSS feed to get them when they land.
        </p>
      </div>
    )
  }
  return (
    <ol className="grid gap-3">
      {notes.map((note) => {
        const minutes = readingMinutes(note.body)
        return (
          <li key={note.id}>
            <Link
              href={`/writing/${note.slug}`}
              transitionTypes={NAV_FORWARD}
              className="press group glass grid gap-2 rounded-xl p-4 outline-none transition-shadow hover:[--glass-shadow:var(--shadow-glass-lg)] focus-visible:ring-3 focus-visible:ring-ring/50 md:p-5"
            >
              <p className="text-meta text-muted-foreground tabular-nums">
                <time dateTime={note.publishedAt}>{formatPublished(note.publishedAt)}</time>
                {minutes > 0 && <> · {minutes} min read</>}
              </p>
              <h2 className="text-card-title text-balance group-hover:text-text-accent">{note.title}</h2>
              {summaryOf(note) && <p className="text-body max-w-prose text-pretty text-muted-foreground">{summaryOf(note)}</p>}
              <span className="text-meta flex items-center gap-1 text-text-accent">
                Read
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        )
      })}
    </ol>
  )
}

function ListSkeleton() {
  return (
    <div className="grid gap-3" aria-hidden>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="glass grid gap-3 rounded-xl p-5">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-3.5 w-full" />
        </div>
      ))}
    </div>
  )
}
