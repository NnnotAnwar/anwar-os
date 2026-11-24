import { Archive, Plant, SunHorizon } from "@/components/icons"
import { defineModule } from "@/core/module"

// Small daily habits with streaks: check them off on Today, in the app or from
// osbot (/habits); osbot can remind at a set time and nudge in the evening.
export const habits = defineModule({
  id: "habits",
  name: "Habits",
  description: "Daily habits on chosen weekdays, with streaks and a one-tap check on Today and in Telegram.",
  icon: Plant,
  nav: [{ label: "Habits", href: "/app/habits" }],
  tagline: "Small things, every day",
  badge: () => import("./badge").then((b) => b.badge),
  shortcuts: [
    { label: "Today", href: "/app/habits", icon: SunHorizon, hint: "Check off today's habits" },
    { label: "Archived", href: "/app/habits?archived=1", icon: Archive },
  ],
  access: { demoable: true, public: true },
  create: { label: "New habit", href: "/app/habits?new=1" },
  widgets: [
    {
      id: "today",
      title: "Habits",
      load: () => import("./widgets/habits-widgets").then((m) => m.TodaysHabits),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
