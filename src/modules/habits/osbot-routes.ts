import "server-only"
import { OsbotApiError, osbotRoute, parseInput } from "@/modules/osbot/api"
import { ackNudges, ackNudgesInput, habitsCard, habitsCardInput, HabitInputError, nudgesDue, toggleFromBot, toggleInput } from "./osbot"

// Handlers for /api/internal/osbot/habits/*; the files under
// src/app/api/internal/osbot/habits/ re-export them. Signed and run as the site
// owner like every osbot endpoint (src/modules/osbot/api.ts).

/** GET habits?date=YYYY-MM-DD: the day's habits (default today) for the /habits card. */
export const habitsGET = osbotRoute(async ({ url, owner }) =>
  habitsCard(parseInput(habitsCardInput, Object.fromEntries(url.searchParams)), owner.timezone),
)

/** POST habits/toggle { id, date? }: flips one habit, returns the day's card. */
export const habitsTogglePOST = osbotRoute(async ({ body, owner }) => {
  try {
    return await toggleFromBot(parseInput(toggleInput, body), owner.timezone)
  } catch (error) {
    if (error instanceof HabitInputError) throw new OsbotApiError(422, "not_changed", error.message)
    throw error
  }
})

/** GET habits/nudges: reminders and the evening nudge due now, not sent yet. */
export const habitsNudgesGET = osbotRoute(async ({ owner }) => nudgesDue(owner.timezone))

/** POST habits/nudges/ack { date, reminders: [habit ids], evening: boolean } once sent. */
export const habitsNudgesAckPOST = osbotRoute(async ({ body }) => ackNudges(parseInput(ackNudgesInput, body)))
