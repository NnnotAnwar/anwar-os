// A document's state on a given day: the chip on the list, the badge, Today.
// `expires_on` is the last day the document is valid. Pure; client-safe.

import { daysBetween, formatDate } from "./dates"

/** Within this many days a document counts as expiring soon (amber; Today's widget). */
export const SOON_DAYS = 90
/** Within this many days it needs action (red-ish; the service card badge). */
export const URGENT_DAYS = 30

export type StatusTone = "valid" | "soon" | "urgent" | "expired"

export type DocumentStatus = {
  tone: StatusTone
  /** Days from today to the expiry date: 0 = expires today, negative = expired. */
  daysLeft: number
  /** The chip: "Valid", "Expires in 30 days", "Expires today", "Expired". */
  label: string
  /** The line under the name: "Valid until 24 Dec 2027", "Expired 3 days ago · 24 Dec 2026". */
  detail: string
}

/** "in 30 days" / "tomorrow" / "today" for a non-negative number of days left. */
export function inDays(daysLeft: number) {
  if (daysLeft <= 0) return "today"
  if (daysLeft === 1) return "tomorrow"
  return `in ${daysLeft} days`
}

/**
 * How long ago it expired, counted from its first invalid day (the day after
 * `expires_on`): that day is "today", the next "yesterday".
 */
export function expiredAgo(daysLeft: number) {
  const ago = -daysLeft - 1
  if (ago <= 0) return "today"
  if (ago === 1) return "yesterday"
  return `${ago} days ago`
}

export function documentStatus(expiresOn: string, today: string): DocumentStatus {
  const daysLeft = daysBetween(today, expiresOn)
  const date = formatDate(expiresOn)
  if (daysLeft < 0) {
    return { tone: "expired", daysLeft, label: "Expired", detail: `Expired ${expiredAgo(daysLeft)} · ${date}` }
  }
  if (daysLeft > SOON_DAYS) {
    return { tone: "valid", daysLeft, label: "Valid", detail: `Valid until ${date}` }
  }
  const when = inDays(daysLeft)
  return {
    tone: daysLeft <= URGENT_DAYS ? "urgent" : "soon",
    daysLeft,
    label: `Expires ${when}`,
    detail: `Expires ${when} · ${date}`,
  }
}

/** Needs attention now: expired, or expiring within URGENT_DAYS. */
export function needsAttention(status: Pick<DocumentStatus, "tone">) {
  return status.tone === "urgent" || status.tone === "expired"
}
