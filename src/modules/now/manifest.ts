import { Compass, Globe, Target } from "@/components/icons"
import { defineModule } from "@/core/module"

// The public /now page ("what I'm doing now"), built from the owner's goals,
// projects, writing and (optionally) a habits aggregate. The private side is
// one settings page: the intro, the place, which sections show and which of
// this year's goals are listed.
export const now = defineModule({
  id: "now",
  name: "Now page",
  description: "Your public /now page: what you're focused on, built from your goals, projects and writing.",
  icon: Compass,
  nav: [{ label: "Now page", href: "/app/now" }],
  tagline: "What you're up to",
  shortcuts: [
    { label: "Open /now", href: "/now", icon: Globe, hint: "What visitors see" },
    { label: "Goals", href: "/app/goals", icon: Target, hint: "Pick which ones show" },
  ],
  access: { demoable: false, public: false },
  actions: () => import("./actions").then((m) => m.actions),
})
