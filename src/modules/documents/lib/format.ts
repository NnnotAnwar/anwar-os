// Wording for reminder offsets, shared by the form, the detail page and tests. Pure.

/** "90, 30 and 7 days before, and on the day". */
export function describeReminders(days: readonly number[]) {
  if (days.length === 0) return "No reminders"
  const before = days.filter((d) => d > 0)
  const onTheDay = days.includes(0)
  const parts: string[] = []
  if (before.length) {
    const list = before.length === 1 ? String(before[0]) : `${before.slice(0, -1).join(", ")} and ${before.at(-1)}`
    parts.push(`${list} ${before.length === 1 && before[0] === 1 ? "day" : "days"} before`)
  }
  if (onTheDay) parts.push("on the day")
  return parts.join(", and ")
}

/** "On the day", "1 day", "30 days". */
export function reminderLabel(days: number) {
  if (days === 0) return "On the day"
  return days === 1 ? "1 day" : `${days} days`
}
