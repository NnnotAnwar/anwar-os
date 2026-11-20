import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Small calculators by Anwar"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Tools",
    title: "Small calculators that run in your browser",
    subtitle: "Calories, arithmetic, statistics and compound growth. Nothing you enter leaves the page.",
  })
}
