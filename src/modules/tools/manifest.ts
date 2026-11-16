import { Calculator } from "lucide-react"
import { defineModule } from "@/core/module"

// Pure client-side math: no tables, no server actions. The same calculators are
// public at /tools; saved results (phase 3) will add the first table, tools_*.
export const tools = defineModule({
  id: "tools",
  name: "Tools",
  description: "Calculators: calories, arithmetic, statistics and compound growth.",
  icon: Calculator,
  nav: [{ label: "Tools", href: "/app/tools" }],
  access: { demoable: true, public: true },
})
