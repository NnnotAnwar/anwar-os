import { Bookmark, Globe, LinkIcon } from "@/components/icons"
import { defineModule } from "@/core/module"

export const links = defineModule({
  id: "links",
  name: "Links",
  description: "Saved links with tags, read-later and a public list.",
  icon: LinkIcon,
  nav: [{ label: "Links", href: "/app/links" }],
  tagline: "Saved for later",
  shortcuts: [
    { label: "Read later", href: "/app/links?view=later", icon: Bookmark },
    { label: "All links", href: "/app/links", icon: LinkIcon },
    { label: "Public links", href: "/links", icon: Globe, hint: "What visitors see" },
  ],
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
