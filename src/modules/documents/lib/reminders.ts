// osbot's expiry reminders, as a pure schedule (unit-tested in reminders.test.ts).
//
// A document with reminder offsets [90, 30, 7, 0] has a "stage" on each of those
// days before its expiry date (0 = the day itself) and one final "expired"
// stage on the day after it. A stage is reached at 10:00 in the owner's clock
// on its day. Each poll, a document is due when its *latest* reached stage
// hasn't been delivered yet:
//   - on time: the bot sends it at ~10:00 on the stage's day;
//   - late: if the bot was down that day, it goes out at the next poll, once;
//   - superseded: an earlier stage that was never sent is dropped as soon as a
//     later one is reached (no "90 days" card after the 30-day one is due).
// Stages before `remindersFrom` (the day the expiry date or offsets were set)
// are never sent, so a renewal or a new document doesn't fire a stale card;
// the "expired" card is sent at most EXPIRED_LATE_DAYS late. "Remind tomorrow"
// (`snoozedUntil`) is one more card at 10:00 on that day, also sent once.
//
// Delivery keys (osbot_deliveries kind "document") include the expiry date, so
// a renewed document starts a fresh schedule.

import { addDaysIso, daysBetween } from "./dates"

export const REMINDER_TIME = "10:00"
export const DEFAULT_REMINDER_DAYS = [90, 30, 7, 0] as const
export const MAX_REMINDER_DAYS = 730
export const MAX_REMINDERS = 8
export const EXPIRED_LATE_DAYS = 30

export type Stage = {
  /** "90", "30", … "0", or "expired". */
  stage: string
  /** The owner's day it is due on (sent from REMINDER_TIME). */
  day: string
}

/** Distinct offsets, largest first (the form and the actions store them like this). */
export function normalizeReminderDays(days: readonly number[]) {
  return [...new Set(days)].sort((a, b) => b - a)
}

/** Every stage of a schedule, earliest first. No offsets = no reminders at all. */
export function reminderStages(expiresOn: string, reminderDays: readonly number[]): Stage[] {
  if (reminderDays.length === 0) return []
  const offsets = normalizeReminderDays(reminderDays)
  return [
    ...offsets.map((offset) => ({ stage: String(offset), day: addDaysIso(expiresOn, -offset) })),
    { stage: "expired", day: addDaysIso(expiresOn, 1) },
  ]
}

/** Whether a day's 10:00 has come, in the owner's clock. */
export function reached(day: string, clock: OwnerClock) {
  return day < clock.today || (day === clock.today && clock.time >= REMINDER_TIME)
}

export const stageKey = (id: string, expiresOn: string, stage: string) => `${id}:${expiresOn}:${stage}`
export const snoozeKey = (id: string, expiresOn: string, until: string) => `${id}:${expiresOn}:snooze-${until}`

/** `<uuid>:<YYYY-MM-DD>:<0-730 | expired | snooze-YYYY-MM-DD>`, capturing the document id. */
export const REMINDER_KEY =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(\d{4}-\d{2}-\d{2}):(\d{1,3}|expired|snooze-\d{4}-\d{2}-\d{2})$/

export type OwnerClock = { today: string; time: string }

export type ScheduledDocument = {
  id: string
  expiresOn: string
  reminderDays: readonly number[]
  remindersFrom: string
  snoozedUntil: string | null
}

export type DueReminder = {
  id: string
  /** The stage being sent ("30", "expired"…), or "snooze" for a snoozed card alone. */
  stage: string
  /** The day it was due; earlier than today when it goes out late. */
  dueOn: string
  late: boolean
  snoozed: boolean
  /** What reminders/ack takes once the card is sent. */
  keys: string[]
}

/** Every key a poll could ask about for this document (to look up what was delivered). */
export function candidateKeys(doc: ScheduledDocument): string[] {
  const keys = reminderStages(doc.expiresOn, doc.reminderDays).map((s) => stageKey(doc.id, doc.expiresOn, s.stage))
  if (doc.snoozedUntil) keys.push(snoozeKey(doc.id, doc.expiresOn, doc.snoozedUntil))
  return keys
}

/** The latest stage that has been reached and may still be sent, if any. */
export function currentStage(doc: ScheduledDocument, clock: OwnerClock): Stage | null {
  const stages = reminderStages(doc.expiresOn, doc.reminderDays).filter((s) => s.day >= doc.remindersFrom && reached(s.day, clock))
  const latest = stages.at(-1) ?? null
  if (latest?.stage === "expired" && daysBetween(latest.day, clock.today) > EXPIRED_LATE_DAYS) return null
  return latest
}

/** What to send for one document now, or null. At most one card per document per poll. */
export function dueReminder(doc: ScheduledDocument, clock: OwnerClock, delivered: ReadonlySet<string>): DueReminder | null {
  const keys: string[] = []
  let due: Omit<DueReminder, "keys" | "snoozed"> | null = null

  const stage = currentStage(doc, clock)
  if (stage) {
    const key = stageKey(doc.id, doc.expiresOn, stage.stage)
    if (!delivered.has(key)) {
      keys.push(key)
      due = { id: doc.id, stage: stage.stage, dueOn: stage.day, late: stage.day < clock.today }
    }
  }

  let snoozed = false
  if (doc.snoozedUntil && reached(doc.snoozedUntil, clock)) {
    const key = snoozeKey(doc.id, doc.expiresOn, doc.snoozedUntil)
    if (!delivered.has(key)) {
      keys.push(key)
      snoozed = true
      // A snooze that lands on a stage's day goes out as that stage's card.
      due ??= { id: doc.id, stage: "snooze", dueOn: doc.snoozedUntil, late: doc.snoozedUntil < clock.today }
    }
  }

  return due ? { ...due, snoozed, keys } : null
}

/** Every document's due card, soonest expiry first (then by name, via the caller's order). */
export function dueReminders<D extends ScheduledDocument>(
  docs: readonly D[],
  clock: OwnerClock,
  delivered: ReadonlySet<string>,
): (DueReminder & { doc: D })[] {
  return docs
    .map((doc) => {
      const due = dueReminder(doc, clock, delivered)
      return due ? { ...due, doc } : null
    })
    .filter((d) => d !== null)
    .sort((a, b) => a.doc.expiresOn.localeCompare(b.doc.expiresOn))
}
