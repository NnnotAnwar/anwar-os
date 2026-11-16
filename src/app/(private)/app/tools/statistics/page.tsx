import { toolMetadata } from "@/modules/tools/catalog"
import { ToolPage } from "@/modules/tools/routes/tool"

export const metadata = toolMetadata("statistics")

export default function StatisticsPage() {
  return <ToolPage slug="statistics" base="/app/tools" />
}
