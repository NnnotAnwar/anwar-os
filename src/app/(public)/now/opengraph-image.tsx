import { connection } from "next/server"
import { ogContentType, ogImage, ogSize } from "@/lib/og"
import { formatPublished } from "@/modules/notes/lib/dates"
import { getNowPage } from "@/modules/now/public"

export const alt = "What Anwar is doing now"
export const size = ogSize
export const contentType = ogContentType

const fallback = "This year's goals, the projects I'm building and my latest writing."

/** The intro the owner wrote and the "Updated" date. Request time: the build has no database. */
export default async function Image() {
  await connection()
  const now = await getNowPage().catch(() => null)
  const focus = now?.goals.slice(0, 2).map((g) => g.title).join(" · ")
  return ogImage({
    eyebrow: now?.updatedAt ? `Now · Updated ${formatPublished(now.updatedAt)}` : "Now",
    title: "What I'm doing now",
    subtitle: now?.intro || (focus ? `Focus: ${focus}` : fallback),
  })
}
