import "server-only"
import { osbotRoute, parseInput } from "./api"
import { ackBrief, ackBriefInput, briefDue, morningBrief } from "./brief"

// osbot's morning brief under /api/internal/osbot/brief*: the card on demand
// (/brief, 🔄 Refresh), the once-a-minute "is it due?" and the ack that keeps
// it to once a day. Signed and run as the site owner like every osbot endpoint.

/** GET brief: today's brief (the owner's day), with `delivered`. */
export const briefGET = osbotRoute(async ({ owner }) => morningBrief(owner.timezone))

/** GET brief/due: { due, date, time, brief } — the brief only when it should go out now. */
export const briefDueGET = osbotRoute(async ({ owner }) => briefDue(owner.timezone))

/** POST brief/ack { date } once the morning brief is sent (date = brief/due's `date`). */
export const briefAckPOST = osbotRoute(async ({ body }) => ackBrief(parseInput(ackBriefInput, body)))
