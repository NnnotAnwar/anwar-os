import "server-only"
import { TaskInputError } from "@/modules/tasks/actions"
import { OsbotApiError, osbotRoute, parseInput } from "./api"
import { ackContact, ackContactInput, contactStatus, contactStatusInput, newContact } from "./contact-alerts"
import {
  ackFeedback,
  ackFeedbackInput,
  ackReminders,
  ackRemindersInput,
  capture,
  CaptureError,
  captureInput,
  captureUndoInput,
  dueInput,
  feedbackStatus,
  feedbackStatusInput,
  heartbeat,
  heartbeatInput,
  listCaptureTargets,
  newFeedback,
  remindersDue,
  taskAction,
  taskActionInput,
  today,
  undoCapture,
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

/** POST capture/undo { kind, id }: deletes what a capture just created (the bot's Undo button). */
export const captureUndoPOST = osbotRoute(async ({ body }) => {
  try {
    return await undoCapture(parseInput(captureUndoInput, body))
  } catch (error) {
    if (error instanceof CaptureError) throw new OsbotApiError(422, "not_undone", error.message)
    throw error
  }
})

/** POST tasks/action { id, action: "complete" | "reopen" | "postpone" | "schedule", dueDate? } */
export const taskActionPOST = osbotRoute(async ({ body, owner }) => {
  try {
    return await taskAction(parseInput(taskActionInput, body), owner.timezone)
  } catch (error) {
    if (error instanceof TaskInputError) throw new OsbotApiError(422, "not_changed", error.message)
    throw error
  }
})

/** POST feedback/status { id, status: "new" | "read" | "in_progress" | "done" | "spam" } */
export const feedbackStatusPOST = osbotRoute(async ({ body }) => feedbackStatus(parseInput(feedbackStatusInput, body)))

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

/** GET contact/new: unannounced contact messages, oldest first. */
export const contactNewGET = osbotRoute(async () => ({ items: await newContact() }))

/** POST contact/ack { ids: string[] } */
export const contactAckPOST = osbotRoute(async ({ body }) => ackContact(parseInput(ackContactInput, body).ids))

/** POST contact/status { id, status: "new" | "replied" | "archived" } */
export const contactStatusPOST = osbotRoute(async ({ body }) => contactStatus(parseInput(contactStatusInput, body)))

/** POST heartbeat { version, startedAt } */
export const heartbeatPOST = osbotRoute(async ({ body }) => {
  await heartbeat(parseInput(heartbeatInput, body))
  return { ok: true }
})
