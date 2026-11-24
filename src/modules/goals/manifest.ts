import { CheckCircle, Target } from "@/components/icons"
import { defineModule } from "@/core/module"

// A handful of goals per year. Tasks and projects link to them; progress shows
// on Today under the year ruler. Private only.
export const goals = defineModule({
  id: "goals",
  name: "Goals",
  description: "A few goals per year, measured by a number or by the tasks and projects linked to them.",
  icon: Target,
  nav: [{ label: "Goals", href: "/app/goals" }],
  tagline: "This year, on purpose",
  badge: () => import("./badge").then((b) => b.badge),
  shortcuts: [{ label: "Achieved", href: "/app/goals?status=done", icon: CheckCircle }],
  access: { demoable: false, public: false },
  create: { label: "New goal", href: "/app/goals/new" },
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
