import "server-only"
import { OsbotApiError, osbotRoute, parseInput } from "./api"
import {
  ackFeedback,
  ackFeedbackInput,
  ackReminders,
  ackRemindersInput,
  capture,
  CaptureError,
  captureInput,
  dueInput,
  heartbeat,
  heartbeatInput,
  listCaptureTargets,
  newFeedback,
  remindersDue,
  today,
} from "./service"

// Handlers for /api/internal/osbot/*; the files under src/app/api/internal/osbot/
// re-export them. Every one is HMAC-checked and runs as the site owner (api.ts).

/** GET capture/targets: where the bot can save things, default first. */
export const captureTargetsGET = osbotRoute(async () => listCaptureTargets())

/** POST capture { kind?: "note" | "link" | "idea" | …, text?, url? }; no kind = the default target. */
export const capturePOST = osbotRoute(async ({ body }) => {
  try {
    return await capture(parseInput(captureInput, body))
  } catch (error) {
    if (error instanceof CaptureError) throw new OsbotApiError(422, "not_captured", error.message)
    throw error
  }
})

/** GET reminders/due?until=<epoch ms>&lookback=<minutes> */
export const remindersDueGET = osbotRoute(async ({ url, owner }) => {
  const input = parseInput(dueInput, Object.fromEntries(url.searchParams))
  const now = new Date()
  return { now: now.toISOString(), reminders: await remindersDue(input, owner.timezone, now) }
})

/** POST reminders/ack { keys: string[] } */
export const remindersAckPOST = osbotRoute(async ({ body }) => ackReminders(parseInput(ackRemindersInput, body)))

/** GET today: the owner's agenda for their current day. */
export const todayGET = osbotRoute(async ({ owner }) => today(owner.timezone))

/** GET feedback/new: unalerted new feedback, oldest first. */
export const feedbackNewGET = osbotRoute(async () => ({ items: await newFeedback() }))

/** POST feedback/ack { ids: string[] } */
export const feedbackAckPOST = osbotRoute(async ({ body }) => ackFeedback(parseInput(ackFeedbackInput, body).ids))

/** POST heartbeat { version, startedAt } */
export const heartbeatPOST = osbotRoute(async ({ body }) => {
  await heartbeat(parseInput(heartbeatInput, body))
  return { ok: true }
})
