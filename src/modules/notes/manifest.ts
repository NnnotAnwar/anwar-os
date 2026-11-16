import { NotebookPen } from "@/components/icons"
import { defineModule } from "@/core/module"

export const notes = defineModule({
  id: "notes",
  name: "Notes",
  description: "Plain-text notes with pinning and search.",
  icon: NotebookPen,
  nav: [{ label: "Notes", href: "/app/notes" }],
  tagline: "Quick thoughts, pinned",
  shortcuts: [
    { label: "All notes", href: "/app/notes", icon: NotebookPen },
  ],
  access: { demoable: true, public: true },
  create: { label: "New note", href: "/app/notes/new" },
  widgets: [
    {
      id: "pinned",
      title: "Pinned notes",
      load: () => import("./widgets/notes-widgets").then((m) => m.PinnedNotes),
    },
    {
      id: "recent",
      title: "Recently edited",
      load: () => import("./widgets/notes-widgets").then((m) => m.RecentNotes),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
