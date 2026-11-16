import { LinkIcon } from "@/components/icons"
import { defineModule } from "@/core/module"

export const links = defineModule({
  id: "links",
  name: "Links",
  description: "Saved links with tags, read-later and a public list.",
  icon: LinkIcon,
  nav: [{ label: "Links", href: "/app/links" }],
  access: { demoable: true, public: true },
  create: { label: "Save link", href: "/app/links?add=1" },
  widgets: [
    {
      id: "read-later",
      title: "Read later",
      load: () => import("./widgets/links-widgets").then((m) => m.ReadLater),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
