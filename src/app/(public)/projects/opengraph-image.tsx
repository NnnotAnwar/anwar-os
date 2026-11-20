import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Projects by Anwar"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Projects",
    title: "Things I've built",
    subtitle: "Products, experiments and coursework, each with a short case study.",
  })
}
