import { Bug, History, Pulse, Robot } from "@/components/icons"
import { defineModule } from "@/core/module"

// Control panel for the server's containers, through ops-agent
// (services/ops-agent). Owner only: it can stop and redeploy services.
export const ops = defineModule({
  id: "ops",
  name: "Ops",
  description: "Health, logs, restarts and deploys for every service on the server, an error log, and an activity log.",
  icon: Pulse,
  nav: [{ label: "Ops", href: "/app/ops" }],
  tagline: "Services and deploys",
  badge: () => import("./badge").then((b) => b.badge),
  shortcuts: [
    { label: "Services", href: "/app/ops", icon: Pulse, hint: "Status, logs, restart, deploy" },
    { label: "Errors", href: "/app/ops#errors", icon: Bug, hint: "Server errors of the app and the bots" },
    { label: "Activity", href: "/app/ops#activity", icon: History, hint: "Who did what, and how it went" },
    { label: "Bots", href: "/app/bots", icon: Robot, hint: "Users, activity, heartbeats" },
  ],
  access: { demoable: false, public: false },
  widgets: [
    {
      id: "systems",
      title: "Systems",
      load: () => import("./widgets/systems").then((m) => m.Systems),
    },
  ],
  actions: () => import("./actions").then((m) => m.actions),
})
