import { Briefcase, Globe } from "@/components/icons"
import { defineModule } from "@/core/module"

// Public showcase at /projects (published rows only, via RLS); the editor and
// drafts live at /app/projects.
export const projects = defineModule({
  id: "projects",
  name: "Projects",
  description: "Showcase of projects with case studies, links and a published / featured switch.",
  icon: Briefcase,
  nav: [{ label: "Projects", href: "/app/projects" }],
  tagline: "Case studies",
  shortcuts: [
    { label: "All projects", href: "/app/projects", icon: Briefcase },
    { label: "Public page", href: "/projects", icon: Globe, hint: "What visitors see" },
  ],
  access: { demoable: false, public: false },
  create: { label: "New project", href: "/app/projects/new" },
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
