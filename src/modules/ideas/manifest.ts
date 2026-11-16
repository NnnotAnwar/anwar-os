import { Lightbulb } from "@/components/icons"
import { defineModule } from "@/core/module"

// A private backlog; ideas the owner publishes appear on /ideas (RLS-enforced).
export const ideas = defineModule({
  id: "ideas",
  name: "Ideas",
  description: "Idea backlog with a status pipeline, tags and an opt-in public page.",
  icon: Lightbulb,
  nav: [{ label: "Ideas", href: "/app/ideas" }],
  access: { demoable: true, public: true },
  create: { label: "New idea", href: "/app/ideas/new" },
  widgets: [
    {
      id: "in-progress",
      title: "Ideas in progress",
      load: () => import("./widgets/ideas-widgets").then((m) => m.IdeasInProgress),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
