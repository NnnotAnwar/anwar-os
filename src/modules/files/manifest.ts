import { Folder } from "@/components/icons"
import { defineModule } from "@/core/module"

export const files = defineModule({
  id: "files",
  name: "Files",
  description: "Knowledge base: folders, uploaded files with tags, and markdown documents.",
  icon: Folder,
  nav: [{ label: "Files", href: "/app/files" }],
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
