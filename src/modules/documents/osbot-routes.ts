import "server-only"
import { OsbotApiError, osbotRoute, parseInput } from "@/modules/osbot/api"
import { DocumentInputError } from "./actions"
import { ackReminders, ackRemindersInput, remindersDue, snoozeInput, snoozeReminder } from "./osbot"

// Handlers for /api/internal/osbot/documents/*; the files under
// src/app/api/internal/osbot/documents/ re-export them. Signed and run as the
// site owner like every osbot endpoint (src/modules/osbot/api.ts).

/** GET documents/reminders/due: expiry reminder cards due now (10:00 owner time), not sent yet. */
export const documentRemindersDueGET = osbotRoute(async ({ owner }) => remindersDue(owner.timezone))

/** POST documents/reminders/ack { keys } once sent: idempotent. */
export const documentRemindersAckPOST = osbotRoute(async ({ body }) => ackReminders(parseInput(ackRemindersInput, body)))

/** POST documents/snooze { id }: one more card tomorrow at 10:00. */
export const documentSnoozePOST = osbotRoute(async ({ body, owner }) => {
  try {
    return await snoozeReminder(parseInput(snoozeInput, body), owner.timezone)
  } catch (error) {
    if (error instanceof DocumentInputError) throw new OsbotApiError(404, "gone", error.message)
    throw error
  }
})
