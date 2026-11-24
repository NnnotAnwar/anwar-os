import type { AppIcon } from "@/components/icons"
import type { ReactNode } from "react"
import type { z } from "zod"
import type { AppRole } from "@/db/schema"

export type { AppRole }

export type NavItem = {
  label: string
  /** Absolute path under /app, e.g. "/app/notes". */
  href: `/app/${string}`
}

/**
 * A typed operation a module offers. The same definition backs server actions
 * today and AI / MCP tools later, so `description` is written for an LLM.
 */
export type ActionDef<I extends z.ZodType = z.ZodType, O = unknown> = {
  description: string
  input: I
  /** "read" actions may be exposed to the AI assistant; "write" ones are opt-in. */
  kind: "read" | "write"
  handler: (input: z.infer<I>) => Promise<O>
}

/** Identity helper that infers the handler's input type from the zod schema. */
export function defineAction<I extends z.ZodType, O>(def: ActionDef<I, O>): ActionDef<I, O> {
  return def
}

/** What the viewer's clock and language look like, for widgets that format dates. */
export type ViewerContext = {
  timezone: string
  locale: string
}

/** A dashboard tile. `load` returns an async Server Component, imported lazily. */
export type WidgetDef = {
  id: string
  title: string
  load: () => Promise<(props: { ctx: ViewerContext }) => Promise<ReactNode>>
}

export type SearchHit = {
  /** Unique within the module. */
  id: string
  title: string
  /** Why it matched: a short excerpt around the match (highlighted in the UI). */
  snippet?: string
  /** Facts about the item, shown small: a date, its list or folder, a status. */
  meta?: string[]
  /** A figure shown on the right in tabular numbers, e.g. an amount. */
  aside?: string
  /** Opens the item itself, not just its module. */
  href: string
}

/**
 * Global search (⌘K, the phone search sheet) asks every module the viewer can
 * use for matches. Runs as the viewer (RLS applies); providers must still filter
 * to the viewer's own rows where a table has a "read published" policy, so the
 * site owner's public rows never show up as someone else's. Return at most
 * `limit` hits, best first; the shell ranks them again across modules.
 */
export type SearchProvider = (query: string, limit: number) => Promise<SearchHit[]>

/** One option inside a service card: a section, a filtered view, a public page. */
export type Shortcut = {
  label: string
  /** Private (`/app/…`) or public (`/…`) path. */
  href: `/${string}`
  icon?: AppIcon
  hint?: string
}

/** The count shown on a service card ("3 new"). Null hides it. */
export type BadgeLoader = () => Promise<{ count: number; label: string } | null>

export type ModuleManifest = {
  /** Stable id: also the table prefix (`<id>_*`) and the route segment. */
  id: string
  name: string
  description: string
  /** Two-to-five words for the service card ("Ideas, notes, plans"). */
  tagline?: string
  icon: AppIcon
  nav: NavItem[]
  /** Options in the service card's sheet, after "Open" and "create". */
  shortcuts?: Shortcut[]
  /** Loaded lazily (server-only code). */
  badge?: () => Promise<BadgeLoader>
  access: {
    /** Usable by anonymous demo visitors on mock data (phase 2). */
    demoable: boolean
    /** Usable by registered non-owner users (phase 5). */
    public: boolean
  }
  /** "New …" entry for the header button and the command palette. */
  create?: { label: string; href: `/app/${string}` }
  widgets?: WidgetDef[]
  /** Loaded lazily so the registry never pulls server code into client bundles. */
  search?: () => Promise<SearchProvider>
  actions?: () => Promise<Record<string, ActionDef>>
}

/** The modules a role may use. The owner always sees everything. */
export function modulesFor<M extends Pick<ModuleManifest, "access">>(
  modules: readonly M[],
  role: AppRole,
): M[] {
  switch (role) {
    case "owner":
      return [...modules]
    case "demo":
      return modules.filter((m) => m.access.demoable)
    case "user":
      return modules.filter((m) => m.access.public)
  }
}

export function defineModule<const M extends ModuleManifest>(manifest: M): M {
  return manifest
}
