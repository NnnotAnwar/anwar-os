import { z } from "zod"
import { projectStatuses, type ProjectStatus } from "@/db/schema/projects"

export { projectStatuses, type ProjectStatus }

export const statusLabels: Record<ProjectStatus, string> = {
  idea: "Idea",
  building: "Building",
  live: "Live",
  paused: "Paused",
  archived: "Archived",
}

/** Empty string → null, anything else must be an http(s) URL. */
const optionalUrl = z
  .string()
  .trim()
  .max(500, "Keep links under 500 characters.")
  .transform((v) => v || null)
  .pipe(z.url({ protocol: /^https?$/, error: "Links start with https:// (or http://)." }).nullable())

export const projectFields = {
  title: z.string().trim().min(1, "Give the project a title.").max(120, "Keep the title under 120 characters."),
  slug: z
    .string()
    .trim()
    .min(1, "The address needs at least one letter or digit.")
    .max(80, "Keep the address under 80 characters.")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, digits and single dashes in the address."),
  summary: z.string().trim().max(300, "Keep the summary under 300 characters — it shows on cards."),
  body: z.string().max(50_000, "The case study is too long to save."),
  status: z.enum(projectStatuses),
  role: z.string().trim().max(120, "Keep the role under 120 characters."),
  stack: z.array(z.string().trim().min(1).max(40)).max(20, "Up to 20 stack tags."),
  liveUrl: optionalUrl,
  repoUrl: optionalUrl,
  demoUrl: optionalUrl,
  coverUrl: optionalUrl,
  featured: z.boolean(),
  isPublic: z.boolean(),
}

export const projectInput = z.object(projectFields)
export type ProjectInput = z.infer<typeof projectInput>

export const createProjectInput = projectInput.partial().required({ title: true })
export const updateProjectInput = projectInput.extend({ id: z.uuid() })
export const projectIdInput = z.object({ id: z.uuid() })
export const projectSlugInput = z.object({ slug: z.string().trim().min(1).max(80) })
export const moveProjectInput = z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) })
export const setProjectFlagInput = z.object({ id: z.uuid(), value: z.boolean() })
export const listProjectsInput = z.object({
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(200).default(200),
})

export type Project = {
  id: string
  title: string
  slug: string
  summary: string
  body: string
  status: ProjectStatus
  role: string
  stack: string[]
  liveUrl: string | null
  repoUrl: string | null
  demoUrl: string | null
  coverUrl: string | null
  featured: boolean
  isPublic: boolean
  sortOrder: number
  updatedAt: string
}

/** What visitors may see: no internal ordering or flags. */
export type PublicProject = Omit<Project, "isPublic" | "sortOrder">

/** Cache tag for every public read of projects (grid, case studies, landing). */
export const PUBLIC_PROJECTS_TAG = "projects:public"
