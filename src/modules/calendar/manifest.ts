import { CalendarDuo, CalendarPlus, ListBullets, Rows } from "@/components/icons"
import { defineModule } from "@/core/module"

export const calendar = defineModule({
  id: "calendar",
  name: "Calendar",
  description: "Events with repeats and reminders, important dates, and a private ICS feed.",
  icon: CalendarPlus,
  nav: [{ label: "Calendar", href: "/app/calendar" }],
  tagline: "Events and dates",
  shortcuts: [
    { label: "Upcoming", href: "/app/calendar?view=agenda", icon: ListBullets, hint: "The next weeks as a list" },
    { label: "This week", href: "/app/calendar?view=week", icon: Rows },
    { label: "Month", href: "/app/calendar?view=month", icon: CalendarDuo },
  ],
  access: { demoable: false, public: false },
  create: { label: "New event", href: "/app/calendar?new=1" },
  widgets: [
    {
      id: "upcoming",
      title: "Today & next 7 days",
      load: () => import("./widgets/calendar-widgets").then((m) => m.Upcoming),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
