import { Suspense } from "react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { requireViewer } from "@/core/auth"
import { actions } from "../actions"
import { Breadcrumbs } from "../components/breadcrumbs"
import { ItemIcon } from "../components/file-type-icon"
import { FilesBrowser } from "../components/files-browser"
import { FilesSearch } from "../components/files-search"
import { FolderTree } from "../components/folder-tree"
import { SortSwitch } from "../components/sort-switch"
import { itemHref } from "../lib/links"
import { storageConfigured } from "../lib/s3"
import { formatBytes } from "../lib/validation"
import { defaultDir, sortItems, sortKeys, type SortDir, type SortKey } from "../schema"

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined)

function dateLocaleOf(locale: string) {
  return locale === "en" || locale === "en-US" ? "en-GB" : locale
}

export default function FilesPage({ searchParams }: PageProps<"/app/files">) {
  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <Suspense fallback={<FilesSkeleton />}>
        <FilesBody searchParams={searchParams} />
      </Suspense>
    </div>
  )
}

async function FilesBody({ searchParams }: Pick<PageProps<"/app/files">, "searchParams">) {
  const params = await searchParams
  const query = one(params.q)?.trim().slice(0, 100) ?? ""
  const rawFolder = one(params.folder)
  const folderId = rawFolder && z.uuid().safeParse(rawFolder).success ? rawFolder : null
  if (rawFolder && !folderId) notFound()
  const sort: SortKey = sortKeys.includes(one(params.sort) as SortKey) ? (one(params.sort) as SortKey) : "name"
  const dir: SortDir = one(params.dir) === "asc" || one(params.dir) === "desc" ? (one(params.dir) as SortDir) : defaultDir(sort)

  const viewer = await requireViewer()
  const [listing, allFolders] = await Promise.all([
    actions.listFolder.handler({ folderId }),
    actions.allFolders.handler({}),
  ])
  if (!listing) notFound()

  const title = listing.folder?.name ?? "Files"
  const count = listing.folders.length + listing.items.length
  const openIds = new Set(listing.path.map((f) => f.id))
  const locale = dateLocaleOf(viewer.locale)

  return (
    <>
      <PageHeader
        eyebrow="Knowledge base"
        title={title}
        meta={count ? `${count} ${count === 1 ? "item" : "items"}` : undefined}
      />
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6">
        <aside className="hidden md:block">
          <div className="glass sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto rounded-xl p-2">
            <FolderTree folders={allFolders} currentId={folderId} openIds={openIds} />
          </div>
        </aside>
        <div className="grid min-w-0 content-start gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Breadcrumbs path={listing.path} />
            {!query && <SortSwitch folderId={folderId} sort={sort} dir={dir} />}
          </div>
          <FilesSearch initialQuery={query} />
          {query ? (
            <SearchResults query={query} locale={locale} timezone={viewer.timezone} />
          ) : (
            <FilesBrowser
              key={folderId ?? "root"}
              folderId={folderId}
              folderName={title === "Files" ? "the top level" : title}
              folders={sort === "name" && dir === "desc" ? [...listing.folders].reverse() : listing.folders}
              items={sortItems(listing.items, sort, dir)}
              allFolders={allFolders}
              dateLocale={locale}
              timezone={viewer.timezone}
              storageReady={storageConfigured()}
            />
          )}
        </div>
      </div>
    </>
  )
}

async function SearchResults({ query, locale, timezone }: { query: string; locale: string; timezone: string }) {
  const results = await actions.search.handler({ query, limit: 50 })
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: timezone })
  return (
    <section className="grid gap-2" aria-labelledby="results-heading">
      <p id="results-heading" className="text-meta text-muted-foreground" role="status">
        {results.length === 0
          ? `Nothing matches “${query}”. Try a shorter word or a tag.`
          : `${results.length} ${results.length === 1 ? "result" : "results"} for “${query}”`}
      </p>
      {results.length > 0 && (
        <ul className="glass divide-y divide-hairline overflow-hidden rounded-xl">
          {results.map((r) => (
            <li key={`${r.kind}:${r.id}`}>
              <Link
                href={itemHref(r)}
                className="flex items-center gap-3 px-3 py-2.5 outline-none hover:bg-white/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset dark:hover:bg-white/5"
              >
                <ItemIcon item={r} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="text-body truncate">{r.name}</span>
                  <span className="text-caption truncate text-muted-foreground">
                    {[
                      r.folderName ? `in ${r.folderName}` : "Top level",
                      r.kind === "document" ? r.excerpt : r.kind === "file" ? r.description || r.tags.map((t) => `#${t}`).join(" ") : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {r.kind !== "folder" && (
                  <span className="text-small hidden shrink-0 text-right text-muted-foreground tabular-nums sm:block">
                    {formatBytes(r.size)} · {day.format(new Date(r.createdAt))}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function FilesSkeleton() {
  return (
    <div className="grid gap-4" aria-hidden>
      <div className="grid gap-2">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="h-7 w-40" />
      </div>
      <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)] md:gap-6">
        <Skeleton className="hidden h-64 rounded-xl md:block" />
        <div className="grid content-start gap-3">
          <Skeleton className="h-9 w-full" />
          <div className="glass grid gap-px overflow-hidden rounded-xl">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <Skeleton className="size-8 rounded-lg" />
                <Skeleton className="h-4 w-1/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
