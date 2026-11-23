import { Pulse, Robot, TelegramLogo } from "@/components/icons"
import { defineModule } from "@/core/module"

// Registry of the owner's Telegram bots with stats read from each bot's own
// schema (or the heartbeat osbot / the expense bot send through web's internal API). Owner only.
export const bots = defineModule({
  id: "bots",
  name: "Bots",
  description: "Your Telegram bots with users, activity, domain stats and a heartbeat: alive or silent.",
  icon: Robot,
  nav: [{ label: "Bots", href: "/app/bots" }],
  tagline: "Telegram bots, alive?",
  badge: () => import("./badge").then((b) => b.badge),
  shortcuts: [
    { label: "All bots", href: "/app/bots", icon: TelegramLogo },
    { label: "Their services", href: "/app/ops", icon: Pulse, hint: "Logs, restart, deploy" },
  ],
  access: { demoable: false, public: false },
  actions: () => import("./actions").then((m) => m.actions),
})
