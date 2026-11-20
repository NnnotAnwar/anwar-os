import { toolMetadata } from "@/modules/tools/catalog"
import { ToolPage } from "@/modules/tools/routes/tool"

export const metadata = toolMetadata("calculator", "/tools")

export default function CalculatorPage() {
  return <ToolPage slug="calculator" base="/tools" />
}
