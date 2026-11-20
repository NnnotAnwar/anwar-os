import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Anwar's CV"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Curriculum vitae",
    title: "Anwar — economics student and web developer",
    subtitle: "Experience, education, skills and languages. Printable as a PDF.",
  })
}
