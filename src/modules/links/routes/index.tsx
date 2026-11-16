import { Suspense } from "react"
import NextLink from "next/link"
import { ExternalLink, LinkDuo, X } from "@/components/icons"
import { EmptyState } from "@/components/list/shortcut-hint"
import { Page, Reveal, SkeletonExit } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { actions } from "../actions"
import { AddLinkForm } from "../components/add-link-form"
import { LinkList } from "../components/link-list"
import { LinksSearch } from "../components/links-search"

type View = "all" | "later" | "public"
const views: { id: View; label: string }[] = [
  { id: "all", label: "All" },
  { id: "later", label: "Read later" },
  { id: "public", label: "Public" },
]

type Filters = { q: string; tag: string; view: View }

function hrefFor(f: Partial<Filters>) {
  const p = new URLSearchParams()
  if (f.q) p.set("q", f.q)
  if (f.tag) p.set("tag", f.tag)
  if (f.view && f.view !== "all") p.set("view", f.view)
  const qs = p.toString()
  return qs ? `/app/links?${qs}` : "/app/links"
}

function readFilters(sp: Record<string, string | string[] | undefined>): Filters & { add: boolean } {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "")
  const view = str(sp.view)
  return {
    q: str(sp.q).slice(0, 100),
    tag: str(sp.tag).slice(0, 32).toLowerCase(),
    view: view === "later" || view === "public" ? view : "all",
    add: sp.add === "1",
  }
}

export default function LinksPage({ searchParams }: PageProps<"/app/links">) {
  return (
    <Page>
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <PageHeader
        eyebrow="Library"
        title="Links"
        description="Paste a link anywhere on this page to save it. Mark the good ones public to share them on your links page."
        actions={
          <NextLink
            href="/links"
            target="_blank"
            className="text-meta inline-flex items-center gap-1 rounded text-text-accent outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Public page
            <ExternalLink className="size-3.5" />
          </NextLink>
        }
      />
      <Suspense
        fallback={
          <SkeletonExit>
            <LinksSkeleton />
          </SkeletonExit>
        }
      >
        <Reveal>
          <LinksBody searchParams={searchParams} />
        </Reveal>
      </Suspense>
    </div>
    </Page>
  )
}

async function LinksBody({ searchParams }: Pick<PageProps<"/app/links">, "searchParams">) {
  const filters = readFilters(await searchParams)
  const { q, tag, view } = filters
  const [links, tags] = await Promise.all([
    actions.list.handler({
      limit: 500,
      query: q || undefined,
      tag: tag || undefined,
      readLater: view === "later" ? true : undefined,
      isPublic: view === "public" ? true : undefined,
    }),
    actions.tags.handler({}),
  ])
  const filtered = Boolean(q || tag || view !== "all")
  const empty = !filtered && links.length === 0

  return (
    <div className="grid gap-4">
      <AddLinkForm autoFocus={filters.add || empty} />
      {empty ? (
        <EmptyState icon={LinkDuo} title="Nothing saved yet">
          Copy a link anywhere and paste it here — the title and icon fill in on their own.
        </EmptyState>
      ) : (
        <>
          <div className="grid gap-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <LinksSearch initialQuery={q} />
              </div>
              <nav aria-label="Show" className="segmented self-start">
                {views.map((v) => (
                  <NextLink
                    key={v.id}
                    href={hrefFor({ ...filters, view: v.id })}
                    aria-current={view === v.id ? "page" : undefined}
                    scroll={false}
                    className={`text-small ${cn(
                      "rounded-lg px-3 py-1.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                      view === v.id && "segment-active text-foreground",
                    )}`}
                  >
                    {v.label}
                  </NextLink>
                ))}
              </nav>
            </div>
            {tags.length > 0 && (
              <nav aria-label="Tags" className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const active = t.tag === tag
                  return (
                    <NextLink
                      key={t.tag}
                      href={hrefFor({ ...filters, tag: active ? "" : t.tag })}
                      aria-current={active ? "true" : undefined}
                      scroll={false}
                      className={`text-caption ${cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                        active
                          ? "bg-primary text-primary-foreground"
                          : "bg-track text-muted-foreground hover:text-foreground",
                      )}`}
                    >
                      #{t.tag}
                      <span className="tabular-nums opacity-70">{t.count}</span>
                      {active && <X className="size-3" aria-label="clear" />}
                    </NextLink>
                  )
                })}
              </nav>
            )}
          </div>

          {filtered && (
            <p className="text-caption text-muted-foreground" role="status">
              {links.length === 0
                ? "Nothing matches. Try fewer words or another tag."
                : `${links.length} ${links.length === 1 ? "link" : "links"}`}
              {filtered && (
                <>
                  {" · "}
                  <NextLink href="/app/links" className="text-text-accent hover:underline">
                    Show all
                  </NextLink>
                </>
              )}
            </p>
          )}
          {links.length > 0 && <LinkList links={links} />}
        </>
      )}
    </div>
  )
}

function LinksSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <div className="glass grid gap-px rounded-xl">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3 px-4 py-3">
            <Skeleton className="size-4" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
