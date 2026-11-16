import { z } from "zod"
import { ideaStatuses, type IdeaStatus } from "@/db/schema/ideas"

export { ideaStatuses, type IdeaStatus }

export const ideaStatusLabels: Record<IdeaStatus, string> = {
  raw: "Raw",
  exploring: "Exploring",
  building: "Building",
  shipped: "Shipped",
  dropped: "Dropped",
}

/** "In progress" on Today and the landing page. */
export const activeStatuses: IdeaStatus[] = ["exploring", "building"]

export const ideaFields = {
  title: z.string().trim().min(1, "Give the idea a title.").max(200, "Keep the title under 200 characters."),
  body: z.string().max(20_000, "These notes are too long to save."),
  status: z.enum(ideaStatuses),
  tags: z.array(z.string().trim().min(1).max(40)).max(20, "Up to 20 tags."),
  isPublic: z.boolean(),
}

export const createIdeaInput = z.object({
  title: ideaFields.title,
  body: ideaFields.body.default(""),
  status: ideaFields.status.default("raw"),
  tags: ideaFields.tags.default([]),
  isPublic: ideaFields.isPublic.default(false),
})
export const updateIdeaInput = z.object({ id: z.uuid(), ...ideaFields })
export const ideaIdInput = z.object({ id: z.uuid() })
export const setIdeaStatusInput = z.object({ id: z.uuid(), status: z.enum(ideaStatuses) })
export const setIdeaPublicInput = z.object({ id: z.uuid(), value: z.boolean() })
export const listIdeasInput = z.object({
  status: z.array(z.enum(ideaStatuses)).optional(),
  query: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(500).default(200),
})

export type Idea = {
  id: string
  title: string
  body: string
  status: IdeaStatus
  tags: string[]
  isPublic: boolean
  createdAt: string
  updatedAt: string
}

export type PublicIdea = Omit<Idea, "isPublic">

export const PUBLIC_IDEAS_TAG = "ideas:public"
