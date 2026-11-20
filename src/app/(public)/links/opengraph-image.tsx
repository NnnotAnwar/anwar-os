import { ogContentType, ogImage, ogSize } from "@/lib/og"

export const alt = "Useful links, collected by Anwar"
export const size = ogSize
export const contentType = ogContentType

export default function Image() {
  return ogImage({
    eyebrow: "Bookmarks",
    title: "Useful links",
    subtitle: "Articles, tools and docs I keep coming back to, grouped by topic.",
  })
}
