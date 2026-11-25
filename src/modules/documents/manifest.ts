import { Stamp } from "@/components/icons"
import { defineModule } from "@/core/module"

// Passport, residence permit, insurance…: expiry dates with Telegram reminders
// (osbot, 90 / 30 / 7 days ahead and on the day) and scans kept in Files.
// Private to the owner: no public page, no sitemap entry, not for demo or
// registered users.
export const documents = defineModule({
  id: "documents",
  name: "Documents",
  description: "Passport, residence permit, insurance: expiry dates, scans and Telegram reminders before they run out.",
  icon: Stamp,
  nav: [{ label: "Documents", href: "/app/documents" }],
  tagline: "Never miss a renewal",
  badge: () => import("./badge").then((b) => b.badge),
  access: { demoable: false, public: false },
  create: { label: "New document", href: "/app/documents/new" },
  widgets: [
    {
      id: "next",
      title: "Documents",
      load: () => import("./widgets/documents-widgets").then((m) => m.NextExpiring),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
