import { toolMetadata } from "@/modules/tools/catalog"
import { ToolPage } from "@/modules/tools/routes/tool"

export const metadata = toolMetadata("compound")

export default function CompoundPage() {
  return <ToolPage slug="compound" base="/tools" />
}
