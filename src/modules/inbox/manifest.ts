import { CheckCircle, TrayArrowDown } from "@/components/icons"
import { defineModule } from "@/core/module"

// Quick capture of anything (press C anywhere), processed later into a task,
// note, link, idea or event. Other features capture through captureToInbox().
export const inbox = defineModule({
  id: "inbox",
  name: "Inbox",
  description: "Capture anything in a second — press C anywhere — and sort it into tasks, notes, links, ideas or events later.",
  icon: TrayArrowDown,
  nav: [{ label: "Inbox", href: "/app/inbox" }],
  tagline: "Capture now, sort later",
  badge: () => import("./badge").then((b) => b.badge),
  shortcuts: [{ label: "Recently processed", href: "/app/inbox?view=processed", icon: CheckCircle }],
  access: { demoable: true, public: true },
  create: { label: "Capture to inbox", href: "/app/inbox?capture=1" },
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
