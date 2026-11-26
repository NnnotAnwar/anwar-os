import "server-only"
import { droppingPublicCache } from "@/core/public-cache"
import { asc, eq, max, sql, type AnyColumn } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { Tx } from "@/db"
import { cvEducation, cvExperience, cvLanguages, cvProfile, cvSkills } from "@/db/schema"
import {
  PUBLIC_CV_TAG,
  entryRefInput,
  moveEntryInput,
  profileInput,
  reorderEntriesInput,
  saveEntryInput,
  setPublishedInput,
  type Cv,
  type EntryKind,
} from "./schema"

// The "read published" policies let everyone see the site owner's public CV,
// so private queries must also say "only mine" (same as links).
const mine = (t: { ownerId: AnyColumn }) => eq(t.ownerId, sql`app.current_user_id()`)
// Visitors have no current user, so the public read names the site owner instead.
const siteOwners = (t: { ownerId: AnyColumn }) => eq(t.ownerId, sql`app.site_owner_id()`)

const tables = {
  experience: cvExperience,
  education: cvEducation,
  skills: cvSkills,
  languages: cvLanguages,
} as const

// The four entry tables share id / sort_order / updated_at; Drizzle can't express
// "any of these tables" generically, so writes go through this one narrowed view.
const entryTable = (kind: EntryKind) => tables[kind] as unknown as typeof cvSkills

const iso = <T extends { updatedAt: Date }>(row: T): Omit<T, "updatedAt"> & { updatedAt: string } => ({
  ...row,
  updatedAt: row.updatedAt.toISOString(),
})

/** Everything the transaction's RLS lets through, in display order: the viewer's own CV, or (for visitors) the site owner's. */
export async function readCv(tx: Tx, whose: "mine" | "site owner" = "mine"): Promise<Cv> {
  const scope = whose === "mine" ? mine : siteOwners
  const [profiles, experience, education, skills, languages] = await Promise.all([
    tx
      .select({
        fullName: cvProfile.fullName,
        headline: cvProfile.headline,
        summary: cvProfile.summary,
        location: cvProfile.location,
        contacts: cvProfile.contacts,
        isPublic: cvProfile.isPublic,
        updatedAt: cvProfile.updatedAt,
      })
      .from(cvProfile)
      .where(scope(cvProfile))
      .limit(1),
    tx
      .select({
        id: cvExperience.id,
        role: cvExperience.role,
        organization: cvExperience.organization,
        location: cvExperience.location,
        startOn: cvExperience.startOn,
        endOn: cvExperience.endOn,
        description: cvExperience.description,
        isPublic: cvExperience.isPublic,
        updatedAt: cvExperience.updatedAt,
      })
      .from(cvExperience)
      .where(scope(cvExperience))
      .orderBy(asc(cvExperience.sortOrder), asc(cvExperience.createdAt)),
    tx
      .select({
        id: cvEducation.id,
        institution: cvEducation.institution,
        degree: cvEducation.degree,
        location: cvEducation.location,
        startOn: cvEducation.startOn,
        endOn: cvEducation.endOn,
        description: cvEducation.description,
        isPublic: cvEducation.isPublic,
        updatedAt: cvEducation.updatedAt,
      })
      .from(cvEducation)
      .where(scope(cvEducation))
      .orderBy(asc(cvEducation.sortOrder), asc(cvEducation.createdAt)),
    tx
      .select({
        id: cvSkills.id,
        name: cvSkills.name,
        category: cvSkills.category,
        isPublic: cvSkills.isPublic,
        updatedAt: cvSkills.updatedAt,
      })
      .from(cvSkills)
      .where(scope(cvSkills))
      .orderBy(asc(cvSkills.sortOrder), asc(cvSkills.createdAt)),
    tx
      .select({
        id: cvLanguages.id,
        name: cvLanguages.name,
        level: cvLanguages.level,
        isPublic: cvLanguages.isPublic,
        updatedAt: cvLanguages.updatedAt,
      })
      .from(cvLanguages)
      .where(scope(cvLanguages))
      .orderBy(asc(cvLanguages.sortOrder), asc(cvLanguages.createdAt)),
  ])
  return {
    profile: profiles[0] ? iso(profiles[0]) : null,
    experience: experience.map(iso),
    education: education.map(iso),
    skills: skills.map(iso),
    languages: languages.map(iso),
  }
}

export const actions = droppingPublicCache([PUBLIC_CV_TAG], {
  get: defineAction({
    description:
      "Get the user's whole CV: profile (name, headline, summary, location, contacts, published flag) and the ordered experience, education, skills and languages, hidden entries included.",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<Cv> => asViewer((tx) => readCv(tx)),
  }),
  saveProfile: defineAction({
    description:
      "Create or replace the CV profile: full name, headline, summary, location, contacts ({label, value, url?}) and whether the CV is published on /cv.",
    kind: "write",
    input: profileInput,
    handler: (input): Promise<{ updatedAt: string }> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .insert(cvProfile)
          .values(input)
          .onConflictDoUpdate({ target: cvProfile.ownerId, set: input })
          .returning({ updatedAt: cvProfile.updatedAt })
        return { updatedAt: row!.updatedAt.toISOString() }
      }),
  }),
  setPublished: defineAction({
    description: "Publish the CV on the public /cv page, or hide all of it.",
    kind: "write",
    input: setPublishedInput,
    handler: ({ value }): Promise<void> =>
      asViewer(async (tx) => {
        await tx
          .insert(cvProfile)
          .values({ isPublic: value })
          .onConflictDoUpdate({ target: cvProfile.ownerId, set: { isPublic: value } })
      }),
  }),
  saveEntry: defineAction({
    description:
      "Add (id null) or replace one CV entry. kind is experience (role, organization, location, startOn, endOn — YYYY-MM, endOn empty while current — description), education (institution, degree, …), skills (name, category) or languages (name, level). New entries go to the end of their section.",
    kind: "write",
    input: saveEntryInput,
    handler: ({ kind, id, fields }): Promise<{ id: string; updatedAt: string }> =>
      asViewer(async (tx) => {
        const table = entryTable(kind)
        if (id) {
          const [row] = await tx
            .update(table)
            .set(fields as never)
            .where(eq(table.id, id))
            .returning({ id: table.id, updatedAt: table.updatedAt })
          if (!row) throw new Error("Entry not found")
          return { id: row.id, updatedAt: row.updatedAt.toISOString() }
        }
        const [last] = await tx.select({ value: max(table.sortOrder) }).from(table).where(mine(table))
        const [row] = await tx
          .insert(table)
          .values({ ...(fields as object), sortOrder: (last?.value ?? -1) + 1 } as never)
          .returning({ id: table.id, updatedAt: table.updatedAt })
        return { id: row!.id, updatedAt: row!.updatedAt.toISOString() }
      }),
  }),
  moveEntry: defineAction({
    description: "Move a CV entry one place up or down within its section.",
    kind: "write",
    input: moveEntryInput,
    handler: ({ kind, id, direction }): Promise<void> =>
      asViewer(async (tx) => {
        const table = entryTable(kind)
        const rows = await tx.select({ id: table.id }).from(table).where(mine(table)).orderBy(asc(table.sortOrder), asc(table.createdAt))
        const from = rows.findIndex((r) => r.id === id)
        const to = direction === "up" ? from - 1 : from + 1
        if (from < 0 || to < 0 || to >= rows.length) return
        ;[rows[from], rows[to]] = [rows[to]!, rows[from]!]
        for (const [index, row] of rows.entries()) {
          await tx.update(table).set({ sortOrder: index }).where(eq(table.id, row.id))
        }
      }),
  }),
  reorderEntries: defineAction({
    description:
      "Put a CV section in the given order: ids is every entry of that kind, first to last. Entries not listed keep their relative order after the listed ones.",
    kind: "write",
    input: reorderEntriesInput,
    handler: ({ kind, ids }): Promise<void> =>
      asViewer(async (tx) => {
        const table = entryTable(kind)
        const rows = await tx.select({ id: table.id }).from(table).where(mine(table)).orderBy(asc(table.sortOrder), asc(table.createdAt))
        const listed = new Set(ids)
        const order = [...ids.filter((id) => rows.some((r) => r.id === id)), ...rows.map((r) => r.id).filter((id) => !listed.has(id))]
        for (const [index, id] of order.entries()) {
          await tx.update(table).set({ sortOrder: index }).where(eq(table.id, id))
        }
      }),
  }),
  deleteEntry: defineAction({
    description: "Permanently delete one CV entry.",
    kind: "write",
    input: entryRefInput,
    handler: ({ kind, id }): Promise<void> =>
      asViewer(async (tx) => {
        const table = entryTable(kind)
        await tx.delete(table).where(eq(table.id, id))
      }),
  }),
})
