import { ogContentType, ogImage, ogSize } from "@/lib/og"
import { getPublishedProject } from "@/modules/projects/public"
import { statusLabels } from "@/modules/projects/schema"

export const alt = "A case study by Anwar"
export const size = ogSize
export const contentType = ogContentType

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = await getPublishedProject(slug)
  if (!project) return ogImage({ eyebrow: "Projects", title: "Things I've built" })
  return ogImage({
    eyebrow: ["Case study", statusLabels[project.status]].join(" · "),
    title: project.title,
    subtitle: project.summary || project.role || undefined,
  })
}
