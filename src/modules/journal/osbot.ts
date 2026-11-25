import "server-only"
import { z } from "zod"
import { asViewer } from "@/core/auth"
import { deliveredKeys, recordDeliveries } from "@/modules/osbot/deliveries"
import { dailySlot, ownerClock } from "@/modules/osbot/lib/schedule"
import { actions, JournalInputError, readSettings, upsertEntry } from "./actions"
import { formatDayLong, formatDayShort } from "./lib/format"
import { TEXT_MAX, type EntrySnapshot, type JournalEntry } from "./schema"

// What osbot needs from the journal: the evening question ("🌙 How was
// today?" with five faces, then one line), /journal on demand, and the
// schedule that sends the question once a day. Runs inside actAs(owner) (the
// osbot API wrapper), so RLS scopes everything to the owner.

function baseUrl() {
  return (process.env.BETTER_AUTH_URL ?? "").replace(/\/+$/, "")
}

const isoDate = z.iso.date("Use a date like 2026-11-25.")

export type JournalCard = {
  date: string
  today: string
  /** "Tuesday 24 Nov". */
  label: string
  /** "Tue 24 Nov 2026": what the bot's prompt carries, so a reply after a restart still knows its day. */
  short: string
  entry: { mood: JournalEntry["mood"]; text: string } | null
  url: string
}

function card(date: string, today: string, entry: { mood: JournalEntry["mood"]; text: string } | null): JournalCard {
  return {
    date,
    today,
    label: formatDayLong(date),
    short: formatDayShort(date, 0),
    entry: entry ? { mood: entry.mood, text: entry.text } : null,
    url: `${baseUrl()}/app/journal?day=${date}`,
  }
}

export const journalCardInput = z.object({ date: isoDate.optional() })

/** The question card for a day (default the owner's today), with what is already written. */
export async function journalCard({ date }: z.infer<typeof journalCardInput>, timezone: string, now = new Date()): Promise<JournalCard> {
  const { today } = ownerClock(now, timezone)
  const day = date ?? today
  return card(day, today, await actions.get.handler({ day }))
}

export const saveInput = z.object({
  date: isoDate,
  mood: z.number().int().min(1).max(5).nullable().optional(),
  // The bot cuts long replies; anything longer is refused with a message it can show.
  text: z.string().max(TEXT_MAX * 4).optional(),
})

export type SaveResult = JournalCard & { previous: EntrySnapshot }

/** A face or the line from Telegram (also how its Undo writes the old version back). */
export async function saveFromBot(input: z.infer<typeof saveInput>, timezone: string, now = new Date()): Promise<SaveResult> {
  if (input.text !== undefined && input.text.replace(/\s+/g, " ").trim().length > TEXT_MAX) {
    throw new JournalInputError(`That's a bit long: keep it under ${TEXT_MAX} characters.`)
  }
  const result = await upsertEntry({ day: input.date, mood: input.mood, text: input.text })
  const { today } = ownerClock(now, timezone)
  return { ...card(result.day, today, result.entry), previous: result.previous }
}

export type JournalDue = { due: boolean; date: string; time: string; card: JournalCard | null }

/**
 * Whether the evening question should go out now: switched on, inside its
 * window (dailySlot: from its time until 3 hours later), not sent yet that
 * day, and the day has no mood yet. Nothing is marked sent until journal/ack.
 */
export async function journalDue(timezone: string, now = new Date()): Promise<JournalDue> {
  const settings = await asViewer(readSettings)
  const slot = dailySlot(now, timezone, settings.promptTime)
  const none = { due: false, date: slot.date, time: settings.promptTime, card: null }
  if (!settings.promptEnabled || slot.state !== "due") return none
  if ((await deliveredKeys("journal", [slot.date])).has(slot.date)) return none
  const entry = await actions.get.handler({ day: slot.date })
  if (entry?.mood) return none
  const { today } = ownerClock(now, timezone)
  return { due: true, date: slot.date, time: settings.promptTime, card: card(slot.date, today, entry) }
}

export const ackInput = z.object({ date: isoDate })

/** Records the evening question for `date` as sent (idempotent). */
export async function ackJournal({ date }: z.infer<typeof ackInput>) {
  return { acked: await recordDeliveries("journal", [date]) }
}

export { JournalInputError }
