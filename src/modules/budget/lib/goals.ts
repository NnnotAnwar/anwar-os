import { monthOf, monthsBetween } from "./dates"

/**
 * What still has to go in each month to reach the target by the deadline, or
 * null without a deadline. Counts whole months left (at least one), so the
 * figure errs on the safe side.
 */
export function monthlyNeeded(
  goal: { targetMinor: number; progressMinor: number; deadline: string | null },
  today: string,
): number | null {
  if (!goal.deadline) return null
  const left = goal.targetMinor - goal.progressMinor
  if (left <= 0) return 0
  const months = Math.max(1, monthsBetween(monthOf(today), monthOf(goal.deadline)))
  return Math.ceil(left / months)
}
