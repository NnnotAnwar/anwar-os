import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Ideas Anwar is exploring"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Ideas",
    title: "Thinking out loud",
    subtitle: "Ideas I'm exploring, building or have shipped — tell me which ones are worth it.",
  })
}
