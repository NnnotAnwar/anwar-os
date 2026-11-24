import "server-only"
import { osbotRoute, parseInput } from "./api"
import { ackPayments, ackPaymentsInput, ackWeekly, ackWeeklyInput, paymentsDue, weeklyInput, weeklyReview } from "./digest"

// Handlers for osbot's scheduled digests under /api/internal/osbot/*; the files
// under src/app/api/internal/osbot/{payments,weekly}/ re-export them. Signed
// and run as the site owner like every osbot endpoint (api.ts).

/** GET payments/due: recurring expenses charging tomorrow that weren't reminded yet. */
export const paymentsDueGET = osbotRoute(async ({ owner }) => paymentsDue(owner.timezone))

/** POST payments/ack { keys: ["<recurring id>:<date>"] } once the reminder is sent. */
export const paymentsAckPOST = osbotRoute(async ({ body }) => ackPayments(parseInput(ackPaymentsInput, body)))

/** GET weekly?date=YYYY-MM-DD: the review of the week containing `date` (default today), with `delivered`. */
export const weeklyGET = osbotRoute(async ({ url, owner }) =>
  weeklyReview(parseInput(weeklyInput, Object.fromEntries(url.searchParams)), owner.timezone),
)

/** POST weekly/ack { week: "<Monday>" } once the Sunday review is sent. */
export const weeklyAckPOST = osbotRoute(async ({ body }) => ackWeekly(parseInput(ackWeeklyInput, body)))
