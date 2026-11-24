"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { z } from "zod"
import { requireViewer } from "@/core/auth"
import { getTodayLayout, upsertPreferences } from "@/core/preferences"
import { normalizeLayout, type TodayLayout } from "@/core/today-layout"
import { todayWidgets } from "@/core/today-widgets"
import {
  encodeThemeCookie,
  isHhmm,
  roundCoordinate,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  THEME_MODES,
  THEME_SCHEDULES,
  type ThemeConfig,
} from "@/lib/theme"

const hhmm = z.string().refine(isHhmm, "Use HH:MM")

const themeInput = z
  .object({
    mode: z.enum(THEME_MODES),
    schedule: z.enum(THEME_SCHEDULES),
    from: hhmm,
    until: hhmm,
    lat: z.number().min(-90).max(90).nullable(),
    lon: z.number().min(-180).max(180).nullable(),
    place: z.string().trim().max(80).nullable().optional(),
  })
  .refine((t) => (t.lat === null) === (t.lon === null), "Give both latitude and longitude")
  .refine((t) => t.schedule !== "sun" || t.lat !== null, "Sunset to sunrise needs a place")

export type ThemeInput = z.input<typeof themeInput>

/** Saves the appearance for this user and mirrors it into the pre-paint cookie. */
export async function saveTheme(raw: ThemeInput): Promise<ThemeConfig> {
  const input = themeInput.parse(raw)
  const theme: ThemeConfig = {
    mode: input.mode,
    schedule: input.schedule,
    from: input.from,
    until: input.until,
    lat: input.lat === null ? null : roundCoordinate(input.lat),
    lon: input.lon === null ? null : roundCoordinate(input.lon),
  }
  await upsertPreferences({
    themeMode: theme.mode,
    themeSchedule: theme.schedule,
    themeDarkFrom: theme.from,
    themeDarkUntil: theme.until,
    themeLat: theme.lat,
    themeLon: theme.lon,
    ...(input.place !== undefined && { themePlace: theme.lat === null ? null : input.place || null }),
  })
  ;(await cookies()).set(THEME_COOKIE, encodeThemeCookie(theme), {
    path: "/",
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: "lax",
    secure: process.env.BETTER_AUTH_URL?.startsWith("https://") ?? false,
  })
  revalidatePath("/app", "layout")
  return theme
}

const key = z.string().min(1).max(80)
const layoutInput = z.object({ order: z.array(key).max(100), hidden: z.array(key).max(100) })

/** Saves the Today layout. Returns the previous one, for the toast's Undo. */
export async function saveTodayLayout(raw: TodayLayout): Promise<{ previous: TodayLayout }> {
  const input = layoutInput.parse(raw)
  const viewer = await requireViewer()
  const available = todayWidgets(viewer.role).map((w) => w.key)
  const previous = await getTodayLayout()
  const next = normalizeLayout(available, input)
  await upsertPreferences({ todayOrder: [...next.order], todayHidden: [...next.hidden] })
  revalidatePath("/app")
  return { previous: { order: [...previous.order], hidden: [...previous.hidden] } }
}

/** Back to the default: every widget, in the modules' own order. */
export async function resetTodayLayout(): Promise<{ previous: TodayLayout }> {
  await requireViewer()
  const previous = await getTodayLayout()
  await upsertPreferences({ todayOrder: [], todayHidden: [] })
  revalidatePath("/app")
  return { previous: { order: [...previous.order], hidden: [...previous.hidden] } }
}
