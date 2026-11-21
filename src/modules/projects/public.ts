import "server-only"
import { and, asc, desc, eq } from "drizzle-orm"
import { cacheLife, cacheTag } from "next/cache"
import { asPublic } from "@/db"
import { projectsProjects as p } from "@/db/schema"
import { projectColumns, toProject } from "./actions"
import { PUBLIC_PROJECTS_TAG, type Project, type PublicProject } from "./schema"

// Reads for visitors. They run without a viewer (asPublic), so RLS lets through
// only the site owner's published rows. Results are cached across requests and
// dropped by updateTag(PUBLIC_PROJECTS_TAG) whenever the owner edits a project.
//
// Callers render them after `await connection()` inside <Suspense>: the build
// has no database, so these never run during prerendering; the first visitor
// fills the cache and everyone after reads from memory.

function toPublic(project: Project): PublicProject {
  const rest: Partial<Project> = { ...project }
  delete rest.isPublic
  delete rest.sortOrder
  delete rest.serviceName // infrastructure detail, never public
  return rest as PublicProject
}

export async function getPublishedProjects(): Promise<PublicProject[]> {
  "use cache"
  cacheTag(PUBLIC_PROJECTS_TAG)
  cacheLife("days")
  const rows = await asPublic((tx) =>
    tx.select(projectColumns).from(p).where(eq(p.isPublic, true)).orderBy(asc(p.sortOrder), desc(p.createdAt)),
  )
  return rows.map((row) => toPublic(toProject(row)))
}

export async function getFeaturedProjects(limit = 3): Promise<PublicProject[]> {
  "use cache"
  cacheTag(PUBLIC_PROJECTS_TAG)
  cacheLife("days")
  const rows = await asPublic((tx) =>
    tx
      .select(projectColumns)
      .from(p)
      .where(and(eq(p.isPublic, true), eq(p.featured, true)))
      .orderBy(asc(p.sortOrder), desc(p.createdAt))
      .limit(limit),
  )
  return rows.map((row) => toPublic(toProject(row)))
}

export async function getPublishedProject(slug: string): Promise<PublicProject | null> {
  "use cache"
  cacheTag(PUBLIC_PROJECTS_TAG)
  cacheLife("days")
  const [row] = await asPublic((tx) =>
    tx
      .select(projectColumns)
      .from(p)
      .where(and(eq(p.isPublic, true), eq(p.slug, slug)))
      .limit(1),
  )
  return row ? toPublic(toProject(row)) : null
}
