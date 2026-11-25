import "server-only"
import { OsbotApiError, osbotRoute, parseInput } from "@/modules/osbot/api"
import { ackInput, ackJournal, journalCard, journalCardInput, JournalInputError, journalDue, saveFromBot, saveInput } from "./osbot"

// Handlers for /api/internal/osbot/journal/*; the files under
// src/app/api/internal/osbot/journal/ re-export them. Signed and run as the
// site owner like every osbot endpoint (src/modules/osbot/api.ts).

/** GET journal?date=YYYY-MM-DD: the question card for a day (default today), with what is written. */
export const journalGET = osbotRoute(async ({ url, owner }) =>
  journalCard(parseInput(journalCardInput, Object.fromEntries(url.searchParams)), owner.timezone),
)

/** POST journal/save { date, mood?, text? }: a face or the line; returns the card and the previous version (Undo). */
export const journalSavePOST = osbotRoute(async ({ body, owner }) => {
  try {
    return await saveFromBot(parseInput(saveInput, body), owner.timezone)
  } catch (error) {
    if (error instanceof JournalInputError) throw new OsbotApiError(422, "not_saved", error.message)
    throw error
  }
})

/** GET journal/due: whether the evening question should go out now, with its card. */
export const journalDueGET = osbotRoute(async ({ owner }) => journalDue(owner.timezone))

/** POST journal/ack { date } once the evening question is sent. */
export const journalAckPOST = osbotRoute(async ({ body }) => ackJournal(parseInput(ackInput, body)))
