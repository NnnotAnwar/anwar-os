import { Suspense } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, ArrowRight, Rss } from "@/components/icons"
import { NAV_BACK, NAV_FORWARD, Page } from "@/components/motion"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Markdown } from "@/lib/markdown"
import { readingMinutes } from "@/lib/reading"
import { pageMetadata } from "@/lib/site"
import { cn } from "@/lib/utils"
import { formatPublished } from "../lib/dates"
import { getPublishedNote, getPublishedNotes } from "../public"
import { summaryOf, type PublicNote } from "../schema"

type Props = PageProps<"/writing/[slug]">

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const note = await getPublishedNote(slug)
  if (!note) return { title: "Not found", robots: { index: false } }
  const metadata = pageMetadata({
    title: note.title,
    description: summaryOf(note, 160) || `${note.title} — a note by Anwar.`,
    path: `/writing/${note.slug}`,
    type: "article",
  })
  return {
    ...metadata,
    openGraph: { ...metadata.openGraph, type: "article", publishedTime: note.publishedAt, modifiedTime: note.updatedAt },
  }
}

export default function PublicNotePage({ params }: Props) {
  return (
    <Suspense fallback={<ArticleSkeleton />}>
      <Article params={params} />
    </Suspense>
  )
}

async function Article({ params }: Pick<Props, "params">) {
  const { slug } = await params
  // Both reads are cached; params keep this out of the build.
  const [note, all] = await Promise.all([getPublishedNote(slug), getPublishedNotes()])
  if (!note) notFound()

  const minutes = readingMinutes(note.body)
  const index = all.findIndex((n) => n.id === note.id)
  const newer = index > 0 ? all[index - 1] : undefined
  const older = index >= 0 && index < all.length - 1 ? all[index + 1] : undefined

  return (
    <Page key={note.id}>
      <article className="mx-auto grid w-full max-w-3xl gap-4">
        <Link
          href="/writing"
          transitionTypes={NAV_BACK}
          className={cn(
            buttonVariants({ variant: "ghost", size: "sm" }),
            "-ml-2 justify-self-start text-muted-foreground max-md:h-11 max-md:px-3",
          )}
        >
          <ArrowLeft />
          All writing
        </Link>

        <header className="glass grid gap-3 rounded-xl p-4 [--glass-shadow:var(--shadow-glass-lg)] md:p-6">
          <p className="text-meta text-muted-foreground tabular-nums">
            <time dateTime={note.publishedAt}>{formatPublished(note.publishedAt)}</time>
            {minutes > 0 && <> · {minutes} min read</>}
          </p>
          <h1 className="font-display text-3xl leading-tight font-bold tracking-[-0.03em] text-balance md:text-4xl">
            {note.title}
          </h1>
          {note.excerpt.trim() && (
            <p className="max-w-prose text-base text-pretty text-muted-foreground md:text-lg">{note.excerpt}</p>
          )}
        </header>

        <section className="glass rounded-xl p-4 text-[15px] md:p-8" aria-label="Article">
          {note.body.trim() ? (
            <Markdown source={note.body} outline className="max-w-prose" />
          ) : (
            <p className="text-meta text-muted-foreground">This note is just a title for now.</p>
          )}
        </section>

        <p className="text-caption flex flex-wrap items-center gap-1.5 text-muted-foreground">
          <Rss className="size-3.5" />
          Get new notes in any reader:
          <a href="/writing/feed.xml" className="text-text-accent underline-offset-4 hover:underline">
            RSS feed
          </a>
        </p>

        {(newer || older) && (
          <nav aria-label="More writing" className="grid gap-3 pt-2 sm:grid-cols-2">
            {older ? <Neighbour note={older} direction="older" /> : <span aria-hidden />}
            {newer && <Neighbour note={newer} direction="newer" />}
          </nav>
        )}
      </article>
    </Page>
  )
}

function Neighbour({ note, direction }: { note: PublicNote; direction: "older" | "newer" }) {
  const isNewer = direction === "newer"
  return (
    <Link
      href={`/writing/${note.slug}`}
      transitionTypes={isNewer ? NAV_FORWARD : NAV_BACK}
      className={cn(
        "press group glass grid min-h-20 content-center gap-1 rounded-xl p-4 outline-none transition-shadow hover:[--glass-shadow:var(--shadow-glass-lg)] focus-visible:ring-3 focus-visible:ring-ring/50",
        isNewer && "text-right sm:col-start-2",
      )}
    >
      <span className={cn("text-eyebrow flex items-center gap-1.5 text-text-accent", isNewer && "justify-end")}>
        {!isNewer && <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" />}
        {isNewer ? "Newer" : "Older"}
        {isNewer && <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />}
      </span>
      <span className="text-card-title">{note.title}</span>
      <span className="text-caption text-muted-foreground tabular-nums">{formatPublished(note.publishedAt)}</span>
    </Link>
  )
}

function ArticleSkeleton() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4" aria-hidden>
      <Skeleton className="h-7 w-28" />
      <div className="glass grid gap-4 rounded-xl p-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-2/3" />
      </div>
      <div className="glass grid gap-2 rounded-xl p-8">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}
