import { pageMetadata } from "@/lib/site"
import { ToolsIndex } from "@/modules/tools/routes"

export const metadata = pageMetadata({
  title: "Tools",
  description: "Calculators for calories, arithmetic, statistics and compound growth. Nothing you enter leaves the page.",
  path: "/tools",
})

export default function ToolsPage() {
  return <ToolsIndex base="/tools" />
}
