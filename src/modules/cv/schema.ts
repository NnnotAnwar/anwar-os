import { z } from "zod"
import type { CvContact } from "@/db/schema/cv"

export type { CvContact }

/** "2024-09" (from <input type="month">) or "2024-09-01" → "2024-09-01"; empty → null. */
const month = z
  .string()
  .trim()
  .transform((v) => v || null)
  .pipe(
    z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])(-01)?$/, "Pick a month, e.g. 2024-09.")
      .transform((v) => (v.length === 7 ? `${v}-01` : v))
      .nullable(),
  )

const text = (max: number, message: string) => z.string().trim().max(max, message)

const contact = z.object({
  label: text(40, "Keep contact labels under 40 characters."),
  value: text(200, "Keep contact values under 200 characters.").min(1, "Each contact needs a value."),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => !v || /^(https?:\/\/|mailto:|tel:)/.test(v), "Contact links start with https://, mailto: or tel:.")
    .optional()
    .transform((v) => v || undefined),
})

export const profileInput = z.object({
  fullName: text(120, "Keep the name under 120 characters."),
  headline: text(160, "Keep the headline under 160 characters."),
  summary: text(2000, "Keep the summary under 2000 characters."),
  location: text(120, "Keep the location under 120 characters."),
  contacts: z.array(contact).max(12, "Up to 12 contacts."),
  isPublic: z.boolean(),
})
export type ProfileInput = z.infer<typeof profileInput>

export const experienceFields = z.object({
  role: text(160, "Keep the role under 160 characters.").min(1, "Add the role or job title."),
  organization: text(160, "Keep the organization under 160 characters."),
  location: text(120, "Keep the location under 120 characters."),
  startOn: month,
  endOn: month,
  description: text(4000, "Keep the description under 4000 characters."),
  isPublic: z.boolean(),
})

export const educationFields = z.object({
  institution: text(160, "Keep the institution under 160 characters.").min(1, "Add the school or university."),
  degree: text(160, "Keep the degree under 160 characters."),
  location: text(120, "Keep the location under 120 characters."),
  startOn: month,
  endOn: month,
  description: text(4000, "Keep the description under 4000 characters."),
  isPublic: z.boolean(),
})

export const skillFields = z.object({
  name: text(80, "Keep the skill under 80 characters.").min(1, "Name the skill."),
  category: text(60, "Keep the group under 60 characters."),
  isPublic: z.boolean(),
})

export const languageFields = z.object({
  name: text(60, "Keep the language under 60 characters.").min(1, "Name the language."),
  level: text(60, "Keep the level under 60 characters."),
  isPublic: z.boolean(),
})

export const entryKinds = ["experience", "education", "skills", "languages"] as const
export type EntryKind = (typeof entryKinds)[number]

export const saveEntryInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("experience"), id: z.uuid().nullable(), fields: experienceFields }),
  z.object({ kind: z.literal("education"), id: z.uuid().nullable(), fields: educationFields }),
  z.object({ kind: z.literal("skills"), id: z.uuid().nullable(), fields: skillFields }),
  z.object({ kind: z.literal("languages"), id: z.uuid().nullable(), fields: languageFields }),
])
export type SaveEntryInput = z.infer<typeof saveEntryInput>

export const entryRefInput = z.object({ kind: z.enum(entryKinds), id: z.uuid() })
export const moveEntryInput = entryRefInput.extend({ direction: z.enum(["up", "down"]) })
/** A whole section in its new order (drag to reorder). Ids missing from the list keep their place after it. */
export const reorderEntriesInput = z.object({ kind: z.enum(entryKinds), ids: z.array(z.uuid()).min(1).max(500) })
export const setPublishedInput = z.object({ value: z.boolean() })

export type Profile = Omit<ProfileInput, "contacts"> & { contacts: CvContact[]; updatedAt: string }
export type Experience = z.infer<typeof experienceFields> & { id: string; updatedAt: string }
export type Education = z.infer<typeof educationFields> & { id: string; updatedAt: string }
export type Skill = z.infer<typeof skillFields> & { id: string; updatedAt: string }
export type Language = z.infer<typeof languageFields> & { id: string; updatedAt: string }

export type Cv = {
  profile: Profile | null
  experience: Experience[]
  education: Education[]
  skills: Skill[]
  languages: Language[]
}

export const PUBLIC_CV_TAG = "cv:public"

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })

/** "Sep 2024 – present", "2019 – Jun 2023" style ranges with an en dash. */
export function formatPeriod(startOn: string | null, endOn: string | null) {
  const fmt = (d: string) => monthFormat.format(new Date(`${d}T00:00:00Z`))
  if (!startOn && !endOn) return ""
  if (!startOn) return fmt(endOn!)
  return `${fmt(startOn)} – ${endOn ? fmt(endOn) : "present"}`
}
