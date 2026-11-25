import { BookOpenText, CalendarDays, Search } from "@/components/icons"
import { defineModule } from "@/core/module"

// One line a day with a mood: written here, on Today or in Telegram (osbot asks
// "How was today?" in the evening); a year of moods at a glance.
export const journal = defineModule({
  id: "journal",
  name: "Journal",
  description: "One line a day with a mood, a year of moods at a glance, and osbot asking how the day was.",
  icon: BookOpenText,
  nav: [{ label: "Journal", href: "/app/journal" }],
  tagline: "One line a day",
  shortcuts: [
    { label: "Today's line", href: "/app/journal", icon: CalendarDays, hint: "How was today?" },
    { label: "Search", href: "/app/journal#entries", icon: Search, hint: "Find an old line" },
  ],
  // Private: only the owner keeps a journal here.
  access: { demoable: false, public: false },
  create: { label: "Journal entry", href: "/app/journal" },
  widgets: [
    {
      id: "today",
      title: "How was today?",
      load: () => import("./widgets/journal-widgets").then((m) => m.HowWasToday),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
