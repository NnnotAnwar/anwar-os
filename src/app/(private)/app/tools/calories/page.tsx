import { toolMetadata } from "@/modules/tools/catalog"
import { ToolPage } from "@/modules/tools/routes/tool"

export const metadata = toolMetadata("calories")

export default function CaloriesPage() {
  return <ToolPage slug="calories" base="/app/tools" />
}
