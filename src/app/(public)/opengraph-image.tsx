import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Anwar — economics student and web developer in Prague"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Economics × web development",
    title: "Hi, I'm Anwar. I build where business strategy meets code.",
    subtitle: "CV, projects, ideas and small tools — from Prague.",
  })
}
