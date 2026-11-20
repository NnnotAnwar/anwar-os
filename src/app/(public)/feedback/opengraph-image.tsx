import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Send Anwar feedback"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Feedback",
    title: "Tell me what you think",
    subtitle: "A complaint, an idea, a question or a thank-you. Anonymous is fine.",
  })
}
