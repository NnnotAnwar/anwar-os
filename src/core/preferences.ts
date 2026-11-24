import "server-only"
import { cache } from "react"
import { eq } from "drizzle-orm"
import { asViewer, requireViewer } from "@/core/auth"
import { getServices } from "@/core/services"
import { corePreferences } from "@/db/schema"
import { DEFAULT_THEME, type ThemeConfig, type ThemeMode, type ThemeSchedule } from "@/lib/theme"
import { EMPTY_LAYOUT, type TodayLayout } from "@/core/today-layout"

type Row = typeof corePreferences.$inferSelect

/** The viewer's preferences row, or null before they saved anything. Cached per request. */
export const getPreferences = cache(async (): Promise<Row | null> => {
  const viewer = await requireViewer()
  const [row] = await asViewer((tx) => tx.select().from(corePreferences).where(eq(corePreferences.ownerId, viewer.id)))
  return row ?? null
})

export function themeFromRow(row: Row | null): ThemeConfig {
  if (!row) return DEFAULT_THEME
  return {
    mode: row.themeMode as ThemeMode,
    schedule: row.themeSchedule as ThemeSchedule,
    from: row.themeDarkFrom,
    until: row.themeDarkUntil,
    lat: row.themeLat,
    lon: row.themeLon,
  }
}

export async function getTheme() {
  const row = await getPreferences()
  return { theme: themeFromRow(row), place: row?.themePlace ?? null }
}

export async function getTodayLayout(): Promise<TodayLayout> {
  const row = await getPreferences()
  return row ? { order: row.todayOrder, hidden: row.todayHidden } : EMPTY_LAYOUT
}

/**
 * Writes some preference columns. A first-ever row must keep the current
 * (default) "My services", not an empty list, so it carries them along.
 */
export async function upsertPreferences(set: Partial<Omit<typeof corePreferences.$inferInsert, "ownerId">>) {
  const { pinnedIds } = await getServices()
  await asViewer((tx) =>
    tx
      .insert(corePreferences)
      .values({ pinnedServices: pinnedIds, ...set })
      .onConflictDoUpdate({ target: corePreferences.ownerId, set }),
  )
}
