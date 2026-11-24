import { z } from "zod"
import type { AnalyticsDevice } from "@/db/schema/analytics"

export const RANGES = [7, 30, 90] as const
export type RangeDays = (typeof RANGES)[number]

export const statsInput = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30),
})

export function parseRange(value: unknown): RangeDays {
  const n = Number(value)
  return (RANGES as readonly number[]).includes(n) ? (n as RangeDays) : 30
}

export type DailyViews = { day: string; views: number }
export type Count = { key: string; views: number }

export type SiteStats = {
  days: RangeDays
  total: number
  /** The same number of days just before this range. */
  previousTotal: number
  daily: DailyViews[]
  pages: Count[]
  referrers: Count[]
  /** Views with no external referrer: typed in, bookmarks, apps that hide it. */
  direct: number
  devices: { device: AnalyticsDevice; views: number }[]
  countries: Count[]
}

/** "+12%" against the previous period; null when there's nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 100)
}

export const deviceLabels: Record<AnalyticsDevice, string> = {
  desktop: "Desktop",
  mobile: "Phone",
  tablet: "Tablet",
}

/** Human names for the public routes on the dashboard. */
export function pageLabel(path: string) {
  if (path === "/") return "Home"
  const [, section, slug] = path.split("/")
  const name = section ? section[0]!.toUpperCase() + section.slice(1) : path
  return slug ? `${name} · ${slug}` : name === "Cv" ? "CV" : name
}
