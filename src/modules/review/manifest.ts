import { CalendarCheck, FilePdf, Folder } from "@/components/icons"
import { defineModule } from "@/core/module"

// The monthly report: money, tasks, captures and site views next to the month
// before. osbot sends it on the 1st (/month any time); a PDF lands in Files.
export const review = defineModule({
  id: "review",
  name: "Monthly report",
  description:
    "Your month in numbers: spending by category against last month, subscriptions, tasks, what you captured and site views. As a page, a PDF, and on the 1st in Telegram.",
  icon: CalendarCheck,
  nav: [{ label: "Monthly report", href: "/app/review" }],
  tagline: "Your month in numbers",
  shortcuts: [
    { label: "This month's PDF", href: "/app/review/pdf", icon: FilePdf },
    { label: "Saved reports", href: "/app/files", icon: Folder, hint: "Files → Reports" },
  ],
  access: { demoable: false, public: false },
  actions: () => import("./actions").then((m) => m.actions),
})
