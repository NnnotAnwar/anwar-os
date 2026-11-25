import "server-only"
import { eq, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { nowSettings as n } from "@/db/schema"
import { defaultNowSettings, nowSettingsInput, type NowSettings } from "./schema"

const columns = {
  intro: n.intro,
  location: n.location,
  showGoals: n.showGoals,
  showProjects: n.showProjects,
  showWriting: n.showWriting,
  showHabits: n.showHabits,
  updatedAt: n.updatedAt,
}

type Row = Omit<NowSettings, "updatedAt"> & { updatedAt: Date }

export function toSettings(row: Row | undefined): NowSettings {
  return row ? { ...row, updatedAt: row.updatedAt.toISOString() } : defaultNowSettings
}

// The site owner's row is readable by everyone (it's the public page's text),
// so reads here say "mine" explicitly instead of trusting RLS to narrow it.
const mine = eq(n.ownerId, sql`app.current_user_id()`)

export const actions = {
  get: defineAction({
    description:
      "Get the settings of the user's public /now page: the intro line, the location line (empty = the CV's location) and which sections show (this year's goals marked for /now, projects in progress, latest writing, a habits aggregate).",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<NowSettings> =>
      asViewer(async (tx) => {
        const [row] = await tx.select(columns).from(n).where(mine).limit(1)
        return toSettings(row)
      }),
  }),
  save: defineAction({
    description:
      "Replace the settings of the public /now page: intro (a line or two, up to 600 characters), location (e.g. Prague, Czech Republic; empty = the CV's location), and showGoals / showProjects / showWriting / showHabits. Habits only ever appear as a count and the longest current streak. Which goals show is set per goal (goals_setShowOnNow).",
    kind: "write",
    input: nowSettingsInput,
    handler: (input): Promise<NowSettings> =>
      asViewer(async (tx) => {
        const [row] = await tx
          .insert(n)
          .values(input)
          .onConflictDoUpdate({ target: n.ownerId, set: input })
          .returning(columns)
        return toSettings(row)
      }),
  }),
}
