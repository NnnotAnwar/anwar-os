import { formatIsoDate, wallClock } from "@/modules/calendar/lib/zoned"

/**
 * The day an offline capture was made, in the user's timezone: what "today",
 * "tomorrow" and "yesterday" in it count from when it reaches the server
 * later. Never later than the server's today (a device clock running fast).
 */
export function captureDay(capturedAt: string, timezone: string, now = new Date()): string {
  const at = new Date(capturedAt)
  const instant = Number.isNaN(at.getTime()) || at > now ? now : at
  return formatIsoDate(wallClock(instant, timezone))
}
