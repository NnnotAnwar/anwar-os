import "server-only"
import { droppingPublicCache } from "@/core/public-cache"
import { and, asc, desc, eq, ilike, like, min, ne, or, sql } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { projectsProjects as p } from "@/db/schema"
import { likeContains } from "@/lib/sql-like"
import { slugify } from "@/lib/tags"
import {
  PUBLIC_PROJECTS_TAG,
  createProjectInput,
  listProjectsInput,
  moveProjectInput,
  projectIdInput,
  setProjectFlagInput,
  updateProjectInput,
  type Project,
} from "./schema"

// The "read published" policy lets everyone see the site owner's public projects,
// so private queries must also say "only mine" (same as links).
const mine = eq(p.ownerId, sql`app.current_user_id()`)

export const projectColumns = {
  id: p.id,
  title: p.title,
  slug: p.slug,
  summary: p.summary,
  body: p.body,
  status: p.status,
  role: p.role,
  stack: p.stack,
  liveUrl: p.liveUrl,
  repoUrl: p.repoUrl,
  demoUrl: p.demoUrl,
  coverUrl: p.coverUrl,
  serviceName: p.serviceName,
  featured: p.featured,
  isPublic: p.isPublic,
  sortOrder: p.sortOrder,
  updatedAt: p.updatedAt,
}

type Row = Omit<Project, "updatedAt"> & { updatedAt: Date }

export function toProject(row: Row): Project {
  return { ...row, updatedAt: row.updatedAt.toISOString() }
}

export class SlugTakenError extends Error {
  constructor() {
    super("Another project already uses this address.")
  }
}

/** `base`, or `base-2`, `base-3`… whichever this owner hasn't used yet. */
async function freeSlug(tx: Tx, base: string, exceptId?: string) {
  const rows = await tx
    .select({ slug: p.slug })
    .from(p)
    .where(and(mine, like(p.slug, `${base}%`), exceptId ? ne(p.id, exceptId) : undefined))
  const taken = new Set(rows.map((r) => r.slug))
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`
}

function isUniqueViolation(error: unknown) {
  const e = error as { code?: string; cause?: { code?: string } }
  return e.code === "23505" || e.cause?.code === "23505"
}

// Every action runs through asViewer(), so RLS scopes it to the signed-in user.
export const actions = droppingPublicCache([PUBLIC_PROJECTS_TAG], {
  list: defineAction({
    description:
      "List the user's projects in their showcase order, drafts included. Optionally filter by text in the title, summary or case study.",
    kind: "read",
    input: listProjectsInput,
    handler: ({ query, limit }): Promise<Project[]> =>
      asViewer(async (tx) => {
        const pattern = query ? likeContains(query) : null
        const rows = await tx
          .select(projectColumns)
          .from(p)
          .where(and(mine, pattern ? or(ilike(p.title, pattern), ilike(p.summary, pattern), ilike(p.body, pattern)) : undefined))
          .orderBy(asc(p.sortOrder), desc(p.createdAt))
          .limit(limit)
        return rows.map(toProject)
      }),
  }),
  get: defineAction({
    description: "Get one project by id with its full case study. Returns null if it doesn't exist.",
    kind: "read",
    input: projectIdInput,
    handler: ({ id }): Promise<Project | null> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(projectColumns).from(p).where(and(mine, eq(p.id, id)))
        return row ? toProject(row) : null
      }),
  }),
  create: defineAction({
    description:
      "Create a project. Only the title is required; the URL slug is derived from it when omitted (and made unique). New projects start unpublished at the top of the showcase.",
    kind: "write",
    input: createProjectInput,
    handler: (input): Promise<{ id: string; slug: string; updatedAt: string }> =>
      asViewer(async (tx) => {
        const slug = await freeSlug(tx, input.slug || slugify(input.title) || "project")
        const [top] = await tx.select({ value: min(p.sortOrder) }).from(p).where(mine)
        const [row] = await tx
          .insert(p)
          .values({ ...input, slug, sortOrder: (top?.value ?? 1) - 1 })
          .returning({ id: p.id, slug: p.slug, updatedAt: p.updatedAt })
        return { id: row!.id, slug: row!.slug, updatedAt: row!.updatedAt.toISOString() }
      }),
  }),
  update: defineAction({
    description: "Replace every editable field of a project (title, slug, texts, status, stack, links, flags).",
    kind: "write",
    input: updateProjectInput,
    handler: ({ id, ...fields }): Promise<{ updatedAt: string }> =>
      asViewer(async (tx) => {
        try {
          const [row] = await tx.update(p).set(fields).where(eq(p.id, id)).returning({ updatedAt: p.updatedAt })
          if (!row) throw new Error("Project not found")
          return { updatedAt: row.updatedAt.toISOString() }
        } catch (error) {
          if (isUniqueViolation(error)) throw new SlugTakenError()
          throw error
        }
      }),
  }),
  setPublished: defineAction({
    description: "Publish a project on the public /projects page, or take it back to drafts.",
    kind: "write",
    input: setProjectFlagInput,
    handler: ({ id, value }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(p).set({ isPublic: value }).where(eq(p.id, id))
      }),
  }),
  setFeatured: defineAction({
    description: "Feature a project on the landing page (it must also be published to show), or stop featuring it.",
    kind: "write",
    input: setProjectFlagInput,
    handler: ({ id, value }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.update(p).set({ featured: value }).where(eq(p.id, id))
      }),
  }),
  move: defineAction({
    description: "Move a project one place up or down in the showcase order.",
    kind: "write",
    input: moveProjectInput,
    handler: ({ id, direction }): Promise<void> =>
      asViewer(async (tx) => {
        const rows = await tx.select({ id: p.id }).from(p).where(mine).orderBy(asc(p.sortOrder), desc(p.createdAt))
        const from = rows.findIndex((r) => r.id === id)
        const to = direction === "up" ? from - 1 : from + 1
        if (from < 0 || to < 0 || to >= rows.length) return
        ;[rows[from], rows[to]] = [rows[to]!, rows[from]!]
        // Rewrite the whole order: a handful of rows, and it heals any ties.
        for (const [index, row] of rows.entries()) {
          await tx.update(p).set({ sortOrder: index }).where(eq(p.id, row.id))
        }
      }),
  }),
  delete: defineAction({
    description: "Permanently delete one of the user's projects by id.",
    kind: "write",
    input: projectIdInput,
    handler: ({ id }): Promise<void> =>
      asViewer(async (tx) => {
        await tx.delete(p).where(eq(p.id, id))
      }),
  }),
})
