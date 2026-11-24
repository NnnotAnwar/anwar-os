"use client"

import type { ReactNode } from "react"
import { Search } from "@/components/icons"
import { Button } from "@/components/ui/button"
import type { SearchHit, SearchResponse } from "@/core/search-rank"
import { highlightParts } from "@/lib/search-text"
import { cn } from "@/lib/utils"

/** A module that takes part in global search, as the shell passes it to the client. */
export type SearchModule = { id: string; name: string; icon: ReactNode }

/** `text` with the parts that match `query` marked. */
export function Highlight({ text, query }: { text: string; query: string }) {
  return highlightParts(text, query).map((part, i) =>
    part.match ? (
      <mark key={i} className="rounded-[3px] bg-accent-500/15 text-inherit dark:bg-accent-400/25">
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  )
}

/** Title, the excerpt that matched, metadata and an amount: one search result. */
export function HitBody({ hit, query, className }: { hit: SearchHit; query: string; className?: string }) {
  return (
    <span className={cn("grid min-w-0 flex-1 gap-0.5 text-left", className)}>
      <span className="flex min-w-0 items-baseline gap-3">
        <span className="text-body-strong min-w-0 flex-1 truncate">
          <Highlight text={hit.title} query={query} />
        </span>
        {hit.aside && (
          <span className="text-body-strong shrink-0 tabular-nums">
            <Highlight text={hit.aside} query={query} />
          </span>
        )}
      </span>
      {hit.snippet && (
        <span className="text-meta truncate text-muted-foreground">
          <Highlight text={hit.snippet} query={query} />
        </span>
      )}
      {hit.meta && hit.meta.length > 0 && (
        <span className="text-caption truncate text-muted-foreground tabular-nums">
          <Highlight text={hit.meta.join(" · ")} query={query} />
        </span>
      )}
    </span>
  )
}

/** "5" or "5+" when the module has more than it returned. */
export function countLabel(group: { hits: unknown[]; more: boolean }) {
  return `${group.hits.length}${group.more ? "+" : ""}`
}

/**
 * Quick filters: All, then the modules. With an overview answer only the
 * modules that matched are offered (with their counts), so a chip never leads
 * to an empty list; before that, every searchable module.
 */
export function ModuleChips({
  modules,
  active,
  onChange,
  overview,
  className,
  size = "md",
}: {
  modules: SearchModule[]
  active: string | null
  onChange: (id: string | null) => void
  overview: SearchResponse | null
  className?: string
  size?: "sm" | "md"
}) {
  const groups = overview?.groups ?? null
  const shown = groups
    ? [
        ...groups.flatMap((g) => modules.filter((m) => m.id === g.moduleId)),
        ...modules.filter((m) => m.id === active && !groups.some((g) => g.moduleId === m.id)),
      ]
    : modules
  const total = groups?.reduce((n, g) => n + g.hits.length, 0) ?? null
  const anyMore = groups?.some((g) => g.more) ?? false

  const chip = (id: string | null, label: string, icon: ReactNode, count: string | null) => {
    const pressed = active === id
    return (
      <button
        key={id ?? "all"}
        type="button"
        aria-pressed={pressed}
        onClick={() => onChange(pressed && id ? null : id)}
        className={cn(
          "relative flex shrink-0 items-center gap-1.5 rounded-lg border px-3 font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5",
          size === "sm" ? "h-7 text-xs" : "h-9 text-sm",
          // Touch: the visible chip stays compact, the hit area reaches 44px.
          "pointer-coarse:after:absolute pointer-coarse:after:-inset-y-1.5 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
          pressed
            ? "border-transparent bg-primary text-primary-foreground"
            : "border-field-border bg-field text-muted-foreground hover:text-foreground",
        )}
      >
        {icon}
        {label}
        {count && " "}
        {count && <span className={cn("tabular-nums", pressed ? "opacity-80" : "opacity-70")}>{count}</span>}
      </button>
    )
  }

  return (
    <div role="group" aria-label="Filter by service" className={cn("flex gap-1.5 overflow-x-auto [scrollbar-width:none]", className)}>
      {chip(null, "All", null, total === null ? null : `${total}${anyMore ? "+" : ""}`)}
      {shown.map((m) => {
        const group = groups?.find((g) => g.moduleId === m.id)
        return chip(m.id, m.name, m.icon, group ? countLabel(group) : null)
      })}
    </div>
  )
}

/** What to try when nothing matched. */
export function NoResults({
  query,
  moduleName,
  onSearchAll,
}: {
  query: string
  /** Set when the search was narrowed to one module. */
  moduleName: string | null
  onSearchAll: () => void
}) {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-10 text-center" role="status">
      <Search className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-body-strong">
        Nothing {moduleName ? `in ${moduleName} ` : ""}matches “{query}”
      </p>
      <p className="text-meta max-w-xs text-muted-foreground">
        Try a shorter or different word, part of a name, or an amount like 250.
      </p>
      {moduleName && (
        <Button variant="outline" size="sm" onClick={onSearchAll} className="mt-1">
          Search all services
        </Button>
      )}
    </div>
  )
}

/** Before typing, with no history yet: what search covers. */
export function SearchIntro() {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-10 text-center">
      <Search className="size-6 text-muted-foreground" aria-hidden />
      <p className="text-body-strong">Search everything</p>
      <p className="text-meta max-w-xs text-muted-foreground">
        Notes, tasks, inbox, events, links, ideas, files and money. Try a word from a note, a person’s name or an amount like 250.
      </p>
    </div>
  )
}

export function SearchError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="grid justify-items-center gap-2 px-6 py-10 text-center" role="alert">
      <p className="text-body-strong">Search didn’t answer</p>
      <p className="text-meta max-w-xs text-muted-foreground">Check your connection, then try again.</p>
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
        Try again
      </Button>
    </div>
  )
}

/** Modules that failed this time; the rest of the answer is still shown. */
export function FailedNote({ failed, modules }: { failed: string[]; modules: SearchModule[] }) {
  if (!failed.length) return null
  const names = failed.map((id) => modules.find((m) => m.id === id)?.name ?? id)
  return <p className="text-caption px-3 py-2 text-muted-foreground">Couldn’t search {names.join(", ")} just now.</p>
}
