import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Contact Anwar"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Contact",
    title: "Let’s work together",
    subtitle: "Job offers, freelance projects or anything that needs a reply.",
  })
}
