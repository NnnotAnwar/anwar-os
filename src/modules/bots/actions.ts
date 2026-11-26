import "server-only"
import { asc, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { asViewer, requireViewer } from "@/core/auth"
import { defineAction } from "@/core/module"
import { botsBots } from "@/db/schema"
import { budgetBotStatus } from "@/modules/budget/bot-api/service"
import { osbotStatus } from "@/modules/osbot/service"
import { fillDays, liveness, readOverview, viewerToday } from "./lib/stats"
import {
  botIdInput,
  botInput,
  knownBots,
  updateBotInput,
  type Bot,
  type BotStats,
  type BotWithStats,
  type DailyPoint,
} from "./schema"

const columns = {
  id: botsBots.id,
  name: botsBots.name,
  telegramUsername: botsBots.telegramUsername,
  serviceName: botsBots.serviceName,
  statsSource: botsBots.statsSource,
  description: botsBots.description,
}

/** The duplicate-name error, readable. */
export class BotInputError extends Error {}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && ((e as { code?: string }).code === "23505" || isUniqueViolation((e as { cause?: unknown }).cause))
}

/**
 * Stats from a bot's own schema. Each bot reads in its own transaction, and a
 * missing schema, view or grant becomes "unavailable" instead of an error, so
 * one broken bot never hides the others.
 */
async function schemaStats(schema: string): Promise<BotStats> {
  if (!/^bot_[a-z0-9_]{1,40}$/.test(schema)) return { kind: "unavailable", reason: "Not a bot schema." }
  // The owner's calendar day, not the server's (UTC): after midnight in Prague
  // the chart already has a new "today", an hour or two before UTC does.
  const today = viewerToday(await requireViewer())
  try {
    return await asViewer(async (tx) => {
      const [check] = (await tx.execute(sql`
        select coalesce(has_table_privilege(to_regclass(${`${schema}.stats_overview`}), 'select'), false) as overview,
               coalesce(has_table_privilege(to_regclass(${`${schema}.stats_daily`}), 'select'), false) as daily`)) as unknown as {
        overview: boolean
        daily: boolean
      }[]
      if (!check?.overview) {
        return {
          kind: "unavailable",
          reason: `No stats yet: ${schema}.stats_overview doesn't exist or isn't shared with the app. It appears once the bot has started.`,
        } satisfies BotStats
      }
      const [row] = (await tx.execute(sql`select * from ${sql.identifier(schema)}.stats_overview`)) as unknown as Record<string, unknown>[]
      let daily: DailyPoint[] = []
      if (check.daily) {
        const rows = (await tx.execute(sql`
          select day::text as day, messages, active_users, expenses
          from ${sql.identifier(schema)}.stats_daily
          where day > ${today}::date - 14 and day <= ${today}::date
          order by day`)) as unknown as { day: string; messages: number; active_users: number; expenses: number }[]
        daily = rows.map((r) => ({
          day: r.day,
          messages: Number(r.messages ?? 0),
          activeUsers: Number(r.active_users ?? 0),
          expenses: Number(r.expenses ?? 0),
        }))
      }
      return { kind: "schema", ...readOverview(row ?? {}), daily: fillDays(daily, today) } satisfies BotStats
    })
  } catch (e) {
    console.error(`bots: stats of ${schema} failed`, e)
    return { kind: "unavailable", reason: `Couldn't read ${schema}'s stats.` }
  }
}

async function statsFor(bot: Bot): Promise<BotStats> {
  if (!bot.statsSource) return { kind: "none" }
  if (bot.statsSource === "osbot") {
    try {
      const s = await osbotStatus()
      return { kind: "osbot", configured: s.configured, lastBeatAt: s.lastBeatAt, startedAt: s.startedAt, version: s.version }
    } catch {
      return { kind: "unavailable", reason: "Couldn't read osbot's heartbeat." }
    }
  }
  if (bot.statsSource === "budget-bot") {
    try {
      const s = await budgetBotStatus()
      return { kind: "budget-bot", configured: s.configured, lastBeatAt: s.lastBeatAt, startedAt: s.startedAt, version: s.version }
    } catch {
      return { kind: "unavailable", reason: "Couldn't read the expense bot's heartbeat." }
    }
  }
  return schemaStats(bot.statsSource)
}

/** Kinds with a heartbeat the panel watches. */
export function hasHeartbeat(stats: BotStats): stats is Extract<BotStats, { lastBeatAt: string | null }> {
  return stats.kind === "schema" || stats.kind === "osbot" || stats.kind === "budget-bot"
}

export function lastBeat(stats: BotStats) {
  return hasHeartbeat(stats) ? stats.lastBeatAt : null
}

export const actions = {
  list: defineAction({
    description: "List the user's registered Telegram bots (name, @username, linked service, stats source).",
    kind: "read",
    input: z.object({}),
    handler: (): Promise<Bot[]> =>
      asViewer((tx) => tx.select(columns).from(botsBots).orderBy(asc(botsBots.sortOrder), asc(botsBots.createdAt))),
  }),

  overview: defineAction({
    description:
      "Every registered bot with its stats: users, active users in 7 and 30 days, domain counters (e.g. expenses), money totals, last heartbeat, messages per day for two weeks.",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<BotWithStats[]> => {
      const bots = await actions.list.handler({})
      return Promise.all(bots.map(async (b) => ({ ...b, stats: await statsFor(b) })))
    },
  }),

  silentCount: defineAction({
    description: "How many registered bots have stopped sending heartbeats (silent for more than 3 minutes).",
    kind: "read",
    input: z.object({}),
    handler: async (): Promise<number> => {
      const now = new Date()
      const list = await actions.overview.handler({})
      return list.filter((b) => {
        const beat = lastBeat(b.stats)
        return hasHeartbeat(b.stats) && liveness(beat, now).state === "silent"
      }).length
    },
  }),

  create: defineAction({
    description: "Register a Telegram bot: name, optional @username, the compose service that runs it and where its stats live.",
    kind: "write",
    input: botInput,
    handler: async (input): Promise<Bot> => {
      try {
        const [row] = await asViewer((tx) => tx.insert(botsBots).values(input).returning(columns))
        return row!
      } catch (e) {
        if (isUniqueViolation(e)) throw new BotInputError(`You already have a bot called “${input.name}”.`)
        throw e
      }
    },
  }),

  update: defineAction({
    description: "Change a registered bot's details.",
    kind: "write",
    input: updateBotInput,
    handler: async ({ id, ...input }): Promise<Bot | null> => {
      try {
        const [row] = await asViewer((tx) => tx.update(botsBots).set(input).where(eq(botsBots.id, id)).returning(columns))
        return row ?? null
      } catch (e) {
        if (isUniqueViolation(e)) throw new BotInputError(`You already have a bot called “${input.name}”.`)
        throw e
      }
    },
  }),

  delete: defineAction({
    description: "Remove a bot from the registry. The bot itself and its data are not touched.",
    kind: "write",
    input: botIdInput,
    handler: async ({ id }): Promise<void> => {
      await asViewer((tx) => tx.delete(botsBots).where(eq(botsBots.id, id)))
    },
  }),

  addKnown: defineAction({
    description: "Register the bots that ship with anwar.os (Expenses and osbot) that aren't in the registry yet.",
    kind: "write",
    input: z.object({}),
    handler: async (): Promise<number> => {
      await requireViewer()
      const existing = await actions.list.handler({})
      const taken = new Set(existing.flatMap((b) => [b.name.toLowerCase(), b.statsSource]))
      const missing = knownBots.filter((k) => !taken.has(k.name.toLowerCase()) && !taken.has(k.statsSource ?? ""))
      if (missing.length === 0) return 0
      await asViewer((tx) =>
        tx.insert(botsBots).values(
          missing.map((k, i) => ({ ...botInput.parse(k), sortOrder: existing.length + i })),
        ),
      )
      return missing.length
    },
  }),
}
