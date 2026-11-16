import { IdCard } from "@/components/icons"
import { defineModule } from "@/core/module"

// Structured résumé: edited at /app/cv, shown at /cv while published.
export const cv = defineModule({
  id: "cv",
  name: "CV",
  description: "Structured résumé — profile, experience, education, skills, languages — with a printable public page.",
  icon: IdCard,
  nav: [{ label: "CV", href: "/app/cv" }],
  access: { demoable: false, public: false },
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
