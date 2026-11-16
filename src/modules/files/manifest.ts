import { Clock, Folder } from "@/components/icons"
import { defineModule } from "@/core/module"

export const files = defineModule({
  id: "files",
  name: "Files",
  description: "Knowledge base: folders, uploaded files with tags, and markdown documents.",
  icon: Folder,
  nav: [{ label: "Files", href: "/app/files" }],
  tagline: "Knowledge base",
  shortcuts: [
    { label: "Browse files", href: "/app/files", icon: Folder },
    { label: "Newest first", href: "/app/files?sort=date&dir=desc", icon: Clock },
  ],
  access: { demoable: false, public: false },
  create: { label: "New document", href: "/app/files/doc/new" },
  widgets: [
    {
      id: "recent",
      title: "Recently added",
      load: () => import("./widgets/files-widgets").then((m) => m.RecentlyAdded),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
