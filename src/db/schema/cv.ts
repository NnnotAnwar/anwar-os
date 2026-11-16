import { sql } from "drizzle-orm"
import { boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { user } from "./auth"

// Module: cv. One profile row per owner plus ordered entry tables. RLS, the
// public-read policies (entries show only while the profile is published),
// triggers and grants live in db/modules/cv.sql.

export type CvContact = { label: string; value: string; url?: string }

const ownerId = () =>
  text("owner_id")
    .notNull()
    .default(sql`app.current_user_id()`)
    .references(() => user.id, { onDelete: "cascade" })

const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const cvProfile = pgTable(
  "cv_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    fullName: text("full_name").notNull().default(""),
    headline: text("headline").notNull().default(""),
    summary: text("summary").notNull().default(""),
    location: text("location").notNull().default(""),
    contacts: jsonb("contacts").$type<CvContact[]>().notNull().default(sql`'[]'::jsonb`),
    /** The whole CV is visible on /cv only while this is on. */
    isPublic: boolean("is_public").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("cv_profile_owner_key").on(t.ownerId),
    check("cv_profile_contacts_array", sql`jsonb_typeof(${t.contacts}) = 'array'`),
  ],
)

export const cvExperience = pgTable(
  "cv_experience",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    role: text("role").notNull(),
    organization: text("organization").notNull().default(""),
    location: text("location").notNull().default(""),
    /** First day of the start month. */
    startOn: date("start_on", { mode: "string" }),
    /** Null while the role is current. */
    endOn: date("end_on", { mode: "string" }),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("cv_experience_owner_order_idx").on(t.ownerId, t.sortOrder),
    check("cv_experience_role_length", sql`char_length(${t.role}) between 1 and 160`),
  ],
)

export const cvEducation = pgTable(
  "cv_education",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    institution: text("institution").notNull(),
    degree: text("degree").notNull().default(""),
    location: text("location").notNull().default(""),
    startOn: date("start_on", { mode: "string" }),
    endOn: date("end_on", { mode: "string" }),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("cv_education_owner_order_idx").on(t.ownerId, t.sortOrder),
    check("cv_education_institution_length", sql`char_length(${t.institution}) between 1 and 160`),
  ],
)

export const cvSkills = pgTable(
  "cv_skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    /** Free-text group, e.g. "Development" or "Business". */
    category: text("category").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("cv_skills_owner_order_idx").on(t.ownerId, t.sortOrder),
    check("cv_skills_name_length", sql`char_length(${t.name}) between 1 and 80`),
  ],
)

export const cvLanguages = pgTable(
  "cv_languages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: ownerId(),
    name: text("name").notNull(),
    /** Free text, e.g. "Native" or "B2 · upper-intermediate". */
    level: text("level").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isPublic: boolean("is_public").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    index("cv_languages_owner_order_idx").on(t.ownerId, t.sortOrder),
    check("cv_languages_name_length", sql`char_length(${t.name}) between 1 and 60`),
  ],
)
