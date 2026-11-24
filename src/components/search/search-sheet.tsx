"use client"

import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { ArrowRight, History, Loader2Icon, Search, X } from "@/components/icons"
import { NAV_FORWARD } from "@/components/motion"
import type { SearchGroup } from "@/core/search-rank"
import { cn } from "@/lib/utils"
import { listenFor, OPEN_SEARCH_EVENT } from "@/components/shell/command-events"
import { clearRecentSearches, forgetSearch, rememberSearch, useRecentSearches } from "./recent-searches"
import {
  countLabel,
  FailedNote,
  HitBody,
  ModuleChips,
  NoResults,
  SearchError,
  SearchIntro,
  type SearchModule,
} from "./search-parts"
import { useGlobalSearch } from "./use-global-search"

// The visible part of the screen above the on-screen keyboard. iOS doesn't
// shrink the layout viewport for the keyboard, so a plain `inset-0` sheet would
// hide its last results behind it.
function subscribeViewport(onChange: () => void) {
  const vv = window.visualViewport
  vv?.addEventListener("resize", onChange)
  vv?.addEventListener("scroll", onChange)
  return () => {
    vv?.removeEventListener("resize", onChange)
    vv?.removeEventListener("scroll", onChange)
  }
}
const viewportSnapshot = () => {
  const vv = window.visualViewport
  return vv ? `${Math.round(vv.height)}:${Math.round(vv.offsetTop)}` : ""
}

function useVisualViewport() {
  const value = useSyncExternalStore(subscribeViewport, viewportSnapshot, () => "")
  if (!value) return undefined
  const [height, top] = value.split(":").map(Number)
  return { height: `${height}px`, top: `${top}px` }
}

/**
 * Phones: search as a full screen of its own, opened from the header's search
 * icon. A large 16px field (iOS won't zoom), recent searches, filter chips,
 * results grouped by service with counts, clear of the notch, the home
 * indicator and the keyboard. Desktop keeps ⌘K (CommandPalette).
 */
export function SearchSheet({ modules }: { modules: SearchModule[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const search = useGlobalSearch()
  const recent = useRecentSearches()
  const input = useRef<HTMLInputElement>(null)
  const viewport = useVisualViewport()

  const { reset } = search
  useEffect(() => {
    // Each opening starts fresh: empty field, recent searches, no stale answers.
    return listenFor(OPEN_SEARCH_EVENT, () => {
      reset()
      setOpen(true)
    })
  }, [reset])

  function opened() {
    rememberSearch(search.q)
    setOpen(false)
  }

  const groups: SearchGroup[] = search.data?.groups ?? []
  const first = groups[0]?.hits[0]
  const activeName = modules.find((m) => m.id === search.module)?.name ?? null
  const iconOf = (id: string) => modules.find((m) => m.id === id)?.icon

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          aria-label="Search"
          initialFocus={input}
          style={viewport}
          className={cn(
            "fixed inset-x-0 top-0 z-50 flex h-dvh flex-col bg-background text-foreground outline-none",
            "pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]",
            "duration-200 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0",
          )}
        >
          <DialogPrimitive.Title className="sr-only">Search</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Search notes, tasks, events, money, files and more.</DialogPrimitive.Description>

          <div className="grid gap-3 border-b border-hairline px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
            <form
              role="search"
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                if (!first) return
                opened()
                router.push(first.href)
              }}
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  ref={input}
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-label="Search everything"
                  placeholder="Search everything"
                  value={search.query}
                  maxLength={100}
                  onChange={(e) => search.setQuery(e.target.value)}
                  // 16px (text-base): iOS zooms the page into any smaller field.
                  className="h-12 w-full rounded-lg border border-field-border bg-field pr-11 pl-10 text-base outline-none placeholder:text-muted-foreground/80 focus-visible:border-accent-500 focus-visible:ring-3 focus-visible:ring-accent-500/20 [&::-webkit-search-cancel-button]:appearance-none"
                />
                {search.loading ? (
                  <Loader2Icon className="absolute top-1/2 right-3.5 size-5 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />
                ) : (
                  search.query && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => {
                        search.setQuery("")
                        input.current?.focus()
                      }}
                      className="absolute top-1/2 right-0.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <X className="size-4" />
                    </button>
                  )
                )}
              </div>
              <DialogPrimitive.Close className="text-body-strong h-11 shrink-0 rounded-lg px-2 text-text-accent outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                Cancel
              </DialogPrimitive.Close>
            </form>
            <ModuleChips
              modules={modules}
              active={search.module}
              onChange={search.setModule}
              overview={search.overview}
              className="-mx-4 px-4"
            />
          </div>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1rem+env(safe-area-inset-bottom))] transition-opacity",
              search.stale && "opacity-60",
            )}
          >
            {!search.q ? (
              recent.length ? (
                <section aria-labelledby="recent-searches" className="px-2 pt-3">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <h2 id="recent-searches" className="text-eyebrow text-muted-foreground">
                      Recent
                    </h2>
                    <button
                      type="button"
                      onClick={clearRecentSearches}
                      className="text-caption h-11 rounded-lg px-2 text-text-accent outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Clear
                    </button>
                  </div>
                  <ul>
                    {recent.map((q) => (
                      <li key={q} className="flex items-center">
                        <button
                          type="button"
                          onClick={() => search.setQuery(q)}
                          className="text-body flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-lg px-2 text-left outline-none active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <History className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{q}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove “${q}” from recent searches`}
                          onClick={() => forgetSearch(q)}
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          <X className="size-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : (
                <SearchIntro />
              )
            ) : search.error ? (
              <SearchError onRetry={search.retry} />
            ) : search.data && !groups.length && !search.loading ? (
              <NoResults query={search.q} moduleName={activeName} onSearchAll={() => search.setModule(null)} />
            ) : (
              <>
                {groups.map((group) => (
                  <section key={group.moduleId} aria-label={group.moduleName} className="px-2 pt-3">
                    <div className="flex items-center gap-2 px-2 pb-1">
                      <h2 className="text-eyebrow flex items-center gap-1.5 text-muted-foreground [&_svg]:size-3.5">
                        {iconOf(group.moduleId)}
                        {group.moduleName}{" "}
                        <span className="tabular-nums">{countLabel(group)}</span>
                      </h2>
                      {group.more && !search.module && (
                        <button
                          type="button"
                          onClick={() => search.setModule(group.moduleId)}
                          className="text-caption ml-auto flex h-11 items-center gap-1 rounded-lg px-2 text-text-accent outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          See all
                          <ArrowRight className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                    <ul>
                      {group.hits.map((hit) => (
                        <li key={hit.id}>
                          <Link
                            href={hit.href}
                            transitionTypes={NAV_FORWARD}
                            onClick={opened}
                            className="flex min-h-14 items-center rounded-lg px-2 py-2 outline-none active:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <HitBody hit={hit} query={search.q} />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {search.data && <FailedNote failed={search.data.failed} modules={modules} />}
                {!search.data && search.loading && <ResultsSkeleton />}
              </>
            )}
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ResultsSkeleton() {
  return (
    <div className="grid gap-4 px-4 pt-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <Fragment key={i}>
          <div className="grid gap-1.5">
            <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        </Fragment>
      ))}
    </div>
  )
}
