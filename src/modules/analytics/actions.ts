import "server-only"
import { sql } from "drizzle-orm"
import { asViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import type { AnalyticsDevice } from "@/db/schema/analytics"
import { statsInput, type Count, type SiteStats } from "./schema"

// Reads of the owner's own counters (RLS: "analytics: read own"). Days are UTC,
// the same days app.record_page_view() counts in. The owner filter is spelled
// out too, so a query stays scoped even if a public policy is ever added.

const today = sql`(now() at time zone 'utc')::date`
const mine = sql`owner_id = app.current_user_id()`

export const actions = {
  stats: defineAction({
    description:
      "Page views of the user's public site for the last 7, 30 or 90 days (UTC): total, the previous period's total, views per day, top pages, top referring sites, direct visits, devices and countries. Cookie-free counts, no visitor data.",
    kind: "read",
    input: statsInput,
    handler: ({ days }): Promise<SiteStats> =>
      asViewer(async (tx) => {
        const from = sql`${today} - ${days - 1}::int`
        const inRange = sql`${mine} and day >= ${from}`

        const [daily, [totals], pages, referrers, devices, countries] = await Promise.all([
          tx.execute<{ day: string; views: number }>(sql`
            select to_char(d, 'YYYY-MM-DD') as day, coalesce(sum(a.views), 0)::int as views
              from generate_series(${from}, ${today}, interval '1 day') d
              left join analytics_daily a on a.day = d::date and a.owner_id = app.current_user_id()
             group by d
             order by d`),
          tx.execute<{ total: number; previous: number }>(sql`
            select coalesce(sum(views) filter (where day >= ${from}), 0)::int as total,
                   coalesce(sum(views) filter (where day < ${from}), 0)::int as previous
              from analytics_daily
             where ${mine} and day >= ${from} - ${days}::int`),
          tx.execute<Count>(sql`
            select path as key, sum(views)::int as views from analytics_daily
             where ${inRange} group by path order by 2 desc, 1 limit 10`),
          tx.execute<Count>(sql`
            select referrer_host as key, sum(views)::int as views from analytics_daily
             where ${inRange} group by referrer_host order by 2 desc, 1 limit 11`),
          tx.execute<{ device: AnalyticsDevice; views: number }>(sql`
            select device, sum(views)::int as views from analytics_daily
             where ${inRange} group by device order by 2 desc`),
          tx.execute<Count>(sql`
            select country as key, sum(views)::int as views from analytics_daily
             where ${inRange} and country <> '' group by country order by 2 desc, 1 limit 10`),
        ])

        const direct = referrers.find((r) => r.key === "")?.views ?? 0
        return {
          days,
          total: totals?.total ?? 0,
          previousTotal: totals?.previous ?? 0,
          daily: [...daily],
          pages: [...pages],
          referrers: referrers.filter((r) => r.key !== "").slice(0, 10),
          direct,
          devices: [...devices],
          countries: [...countries],
        }
      }),
  }),
}
