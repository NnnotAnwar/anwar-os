import "server-only"
import { cache } from "react"
import { sql } from "drizzle-orm"
import { cacheLife, cacheTag } from "next/cache"
import { asPublic } from "@/db"
import { nowSettings as n } from "@/db/schema"
import { getPublicCv } from "@/modules/cv/public"
import { getPublishedNotes } from "@/modules/notes/public"
import type { PublicNote } from "@/modules/notes/schema"
import { getPublishedProjects } from "@/modules/projects/public"
import type { PublicProject } from "@/modules/projects/schema"
import { toSettings } from "./actions"
import { habitsLine, latestDate, pickNowProjects, toNowGoal, type NowGoalRow } from "./lib/compose"
import { NOW_PUBLIC_TAG, type NowGoal, type NowHabits, type NowSettings } from "./schema"

// Reads for the public /now page. No viewer (asPublic), so only what the SQL
// lets visitors see comes back: the site owner's settings row (its RLS
// policy), and goals and habits through app.now_goals() / app.now_habits(),
// which check the owner, the per-goal flag and the section switches themselves.
// Cached for an hour at most (goal progress logged over MCP or a habit checked
// in doesn't drop the tag) and dropped at once by the owner's edits in the app.
// Render after `await connection()`: no database at build time.

export async function getPublicNowSettings(): Promise<NowSettings> {
  "use cache"
  cacheTag(NOW_PUBLIC_TAG)
  cacheLife("hours")
  const [row] = await asPublic((tx) =>
    tx
      .select({
        intro: n.intro,
        location: n.location,
        showGoals: n.showGoals,
        showProjects: n.showProjects,
        showWriting: n.showWriting,
        showHabits: n.showHabits,
        updatedAt: n.updatedAt,
      })
      .from(n)
      .where(sql`${n.ownerId} = app.site_owner_id()`)
      .limit(1),
  )
  return toSettings(row)
}

export async function getPublicNowGoals(): Promise<NowGoal[]> {
  "use cache"
  cacheTag(NOW_PUBLIC_TAG)
  cacheLife("hours")
  const rows = await asPublic((tx) => tx.execute<NowGoalRow>(sql`select * from app.now_goals()`))
  return [...rows].map(toNowGoal)
}

export type NowPage = {
  intro: string
  /** The settings' place, else the published CV's; "" = no line. */
  location: string
  goals: NowGoal[]
  projects: PublicProject[]
  notes: PublicNote[]
  habits: string | null
  /** The newest change among what the page shows (and its own text); null when it shows nothing dated. */
  updatedAt: string | null
}

/**
 * Everything /now shows, from cached reads. Sections the owner switched off
 * aren't read at all. Deduplicated per request (the page and its metadata
 * both ask). Call at request time only.
 */
export const getNowPage = cache(async (): Promise<NowPage> => {
  const settings = await getPublicNowSettings()
  const [goals, projects, notes, habits, cv] = await Promise.all([
    settings.showGoals ? getPublicNowGoals() : [],
    settings.showProjects ? getPublishedProjects().then((all) => pickNowProjects(all)) : [],
    settings.showWriting ? getPublishedNotes().then((all) => all.slice(0, 3)) : [],
    settings.showHabits ? getPublicNowHabits() : null,
    settings.location ? null : getPublicCv(),
  ])
  return {
    intro: settings.intro,
    location: settings.location || cv?.profile?.location || "",
    goals,
    projects,
    notes,
    habits: habitsLine(habits),
    updatedAt: latestDate([
      settings.updatedAt,
      ...goals.map((g) => g.updatedAt),
      ...projects.map((p) => p.updatedAt),
      ...notes.map((n) => n.updatedAt),
    ]),
  }
})

export async function getPublicNowHabits(): Promise<NowHabits | null> {
  "use cache"
  cacheTag(NOW_PUBLIC_TAG)
  cacheLife("hours")
  const [row] = await asPublic((tx) =>
    tx.execute<{ habits: number; daily: number; longest_streak: number }>(sql`select * from app.now_habits()`),
  )
  return row ? { habits: Number(row.habits), daily: Number(row.daily), longestStreak: Number(row.longest_streak) } : null
}
