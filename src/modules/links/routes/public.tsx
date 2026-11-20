import { Suspense } from "react"
import { connection } from "next/server"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Favicon } from "../components/favicon"
import { groupByTag, listPublishedLinks } from "../public"
import { domainOf } from "../schema"

/** Public /links: the owner's published bookmarks, grouped by tag. */
export default function PublicLinksPage() {
  return (
    <Page>
      {/* A plain page: the public layout provides the frame, <main> and gutters. */}
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <PageHeader
          eyebrow="Bookmarks"
          title="Useful links"
          description="Articles, tools and docs I keep coming back to, grouped by topic."
        />
        <Suspense
          fallback={
            <SkeletonExit>
              <PublicSkeleton />
            </SkeletonExit>
          }
        >
          <Reveal>
            <PublishedLinks />
          </Reveal>
        </Suspense>
      </div>
    </Page>
  )
}

async function PublishedLinks() {
  // Read per request: CI builds without a database, and new links show at once.
  await connection()
  const groups = groupByTag(await listPublishedLinks())

  if (groups.length === 0) {
    return <p className="text-meta text-muted-foreground">Nothing shared yet. Check back soon.</p>
  }

  return (
    <div className="grid gap-4">
      {groups.length > 1 && (
        <nav aria-label="Topics" className="flex flex-wrap gap-1.5">
          {groups.map(({ tag, links }) => (
            <a
              key={tag || "other"}
              href={`#${anchor(tag)}`}
              className="text-caption rounded-full bg-track px-2.5 py-1 text-muted-foreground max-sm:px-3 max-sm:py-2.5 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {tag ? `#${tag}` : "Other"} <span className="tabular-nums">{links.length}</span>
            </a>
          ))}
        </nav>
      )}
      {groups.map(({ tag, links }) => (
        <section
          key={tag || "other"}
          id={anchor(tag)}
          aria-labelledby={`${anchor(tag)}-title`}
          className="glass grid scroll-mt-20 gap-1 rounded-xl p-4"
        >
          <h2 id={`${anchor(tag)}-title`} className="text-card-title mb-1">
            {tag ? `#${tag}` : "Other"}
          </h2>
          <ul className="grid gap-0.5">
            {links.map((link) => (
              <li key={link.id}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-2 outline-none hover:bg-track focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Favicon src={link.favicon_url} name={link.site_name || link.url.replace(/^https?:\/\//, "")} className="mt-0.5" />
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="text-body">{link.title}</span>
                    {link.description && (
                      <span className="text-meta line-clamp-2 text-muted-foreground">{link.description}</span>
                    )}
                    <span className="text-caption text-muted-foreground">{link.site_name || domainOf(link.url)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

const anchor = (tag: string) => (tag ? `tag-${encodeURIComponent(tag)}` : "tag-other")

function PublicSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="glass grid gap-3 rounded-xl p-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ))}
    </div>
  )
}
