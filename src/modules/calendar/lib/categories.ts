// Mirrors calendarCategories in src/db/schema/calendar.ts (kept separate so
// client components never import Drizzle); a unit test keeps them equal.
export const calendarCategories = ["personal", "work", "health", "social", "travel", "birthday", "deadline"] as const
export type CalendarCategory = (typeof calendarCategories)[number]

/**
 * Display data for the fixed categories. The dot is a hint only; the label is
 * always shown next to it somewhere (colour is never the only signal).
 * Classes are literal so Tailwind sees them.
 */
export const categoryInfo: Record<CalendarCategory, { label: string; dot: string; important: boolean }> = {
  personal: { label: "Personal", dot: "bg-accent-500", important: false },
  work: { label: "Work", dot: "bg-accent-800 dark:bg-accent-300", important: false },
  health: { label: "Health", dot: "bg-accent-300 dark:bg-accent-600", important: false },
  social: { label: "Social", dot: "bg-chart-4", important: false },
  travel: { label: "Travel", dot: "bg-accent-200 dark:bg-accent-900", important: false },
  birthday: { label: "Birthday", dot: "bg-primary ring-2 ring-primary/25", important: true },
  deadline: { label: "Deadline", dot: "bg-destructive ring-2 ring-destructive/25", important: true },
}
