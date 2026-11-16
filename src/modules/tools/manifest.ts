import { Calculator, Flame, Sigma, TrendingUp } from "@/components/icons"
import { defineModule } from "@/core/module"

// Pure client-side math: no tables, no server actions. The same calculators are
// public at /tools; saved results (phase 3) will add the first table, tools_*.
export const tools = defineModule({
  id: "tools",
  name: "Tools",
  description: "Calculators: calories, arithmetic, statistics and compound growth.",
  icon: Calculator,
  nav: [{ label: "Tools", href: "/app/tools" }],
  tagline: "Calculators",
  shortcuts: [
    { label: "Calories", href: "/app/tools/calories", icon: Flame, hint: "BMR, TDEE and macros" },
    { label: "Calculator", href: "/app/tools/calculator", icon: Calculator },
    { label: "Statistics", href: "/app/tools/statistics", icon: Sigma, hint: "Mean, median, quartiles" },
    { label: "Compound growth", href: "/app/tools/compound", icon: TrendingUp },
  ],
  access: { demoable: true, public: true },
})
