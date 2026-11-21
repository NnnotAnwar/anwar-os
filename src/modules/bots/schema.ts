import { z } from "zod"

const optional = (schema: z.ZodString) =>
  z
    .string()
    .trim()
    .transform((v) => v || null)
    .pipe(schema.nullable())

export const botFields = {
  name: z.string().trim().min(1, "Give the bot a name.").max(60, "Keep the name under 60 characters."),
  telegramUsername: z
    .string()
    .trim()
    .transform((v) => v.replace(/^@/, "") || null)
    .pipe(
      z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9_]{3,31}$/, "Telegram usernames are 4–32 letters, digits or _, starting with a letter.")
        .nullable(),
    ),
  serviceName: optional(z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,62}$/, "Use the compose service name, e.g. bot-expenses.")),
  statsSource: optional(z.string().regex(/^(osbot|bot_[a-z0-9_]{1,40})$/, "Use the bot's schema (bot_…) or osbot.")),
  description: z.string().trim().max(300, "Keep the description under 300 characters."),
}

export const botInput = z.object(botFields)
export type BotInput = z.input<typeof botInput>
export const updateBotInput = botInput.extend({ id: z.uuid() })
export const botIdInput = z.object({ id: z.uuid() })

export type Bot = {
  id: string
  name: string
  telegramUsername: string | null
  serviceName: string | null
  statsSource: string | null
  description: string
}

export type DailyPoint = { day: string; messages: number; activeUsers: number; expenses: number }

export type BotStats =
  | { kind: "none" }
  | { kind: "unavailable"; reason: string }
  | {
      kind: "schema"
      users: number | null
      active7d: number | null
      active30d: number | null
      /** Domain counters from the view, e.g. { label: "Expenses", value: 120 }. */
      counters: { label: string; value: number }[]
      /** Sums per currency in minor units, e.g. { CZK: 2827060 }. */
      amounts: Record<string, number>
      lastBeatAt: string | null
      version: string | null
      daily: DailyPoint[]
    }
  | { kind: "osbot"; configured: boolean; lastBeatAt: string | null; startedAt: string | null; version: string | null }

export type BotWithStats = Bot & { stats: BotStats }

/** Bots this repo ships, for one-tap registration. */
export const knownBots: (z.input<typeof botInput> & { key: string })[] = [
  {
    key: "expenses",
    name: "Expenses",
    telegramUsername: "",
    serviceName: "bot-expenses",
    statsSource: "bot_expenses",
    description: "Tracks personal expenses: /add, /history, /stats.",
  },
  {
    key: "osbot",
    name: "osbot",
    telegramUsername: "",
    serviceName: "bot-osbot",
    statsSource: "osbot",
    description: "The platform's own bot: reminders, feedback alerts, quick capture.",
  },
]
