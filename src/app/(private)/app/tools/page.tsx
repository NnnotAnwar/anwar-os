import { ToolsIndex } from "@/modules/tools/routes"

export const metadata = {
  title: "Tools",
  description: "Calculators for calories, arithmetic, statistics and compound growth.",
}

export default function ToolsPage() {
  return <ToolsIndex base="/app/tools" />
}
