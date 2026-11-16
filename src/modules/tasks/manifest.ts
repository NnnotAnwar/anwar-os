import { CalendarDays, CheckCircle, ListBullets, ListChecks, SunHorizon } from "@/components/icons"
import { defineModule } from "@/core/module"

export const tasks = defineModule({
  id: "tasks",
  name: "Tasks",
  description: "To-dos with dates, lists, priorities and repeats. Type them in plain words.",
  icon: ListChecks,
  nav: [{ label: "Tasks", href: "/app/tasks" }],
  tagline: "What to do, when",
  badge: () => import("./badge").then((b) => b.badge),
  shortcuts: [
    { label: "Today", href: "/app/tasks", icon: SunHorizon, hint: "Overdue and due today" },
    { label: "Upcoming", href: "/app/tasks?view=upcoming", icon: CalendarDays, hint: "The next 7 days" },
    { label: "Lists", href: "/app/tasks?view=lists", icon: ListBullets },
    { label: "Done", href: "/app/tasks?view=done", icon: CheckCircle, hint: "Recently completed" },
  ],
  access: { demoable: true, public: true },
  create: { label: "New task", href: "/app/tasks?new=1" },
  widgets: [
    {
      id: "today",
      title: "Today's tasks",
      load: () => import("./widgets/tasks-widgets").then((m) => m.TodaysTasks),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
