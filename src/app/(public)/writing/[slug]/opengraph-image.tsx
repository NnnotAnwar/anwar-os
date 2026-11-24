import { ogContentType, ogImage, ogSize } from "@/lib/og"
import { readingMinutes } from "@/lib/reading"
import { formatPublished } from "@/modules/notes/lib/dates"
import { getPublishedNote } from "@/modules/notes/public"
import { summaryOf } from "@/modules/notes/schema"

export const alt = "A note by Anwar"
export const size = ogSize
export const contentType = ogContentType

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const note = await getPublishedNote(slug)
  if (!note) return ogImage({ eyebrow: "Writing", title: "Notes, written up" })
  const minutes = readingMinutes(note.body)
  return ogImage({
    eyebrow: ["Writing", formatPublished(note.publishedAt), minutes ? `${minutes} min read` : null]
      .filter(Boolean)
      .join(" · "),
    title: note.title,
    subtitle: summaryOf(note, 140) || undefined,
  })
}
