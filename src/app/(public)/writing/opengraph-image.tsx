import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Writing by Anwar"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Writing",
    title: "Notes, written up",
    subtitle: "Things I worked out while building, studying and self-hosting.",
  })
}
