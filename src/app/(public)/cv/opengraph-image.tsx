import { connection } from "next/server"
import { ogContentType, ogImage, ogSize } from "@/lib/og"
import { getPublicCv } from "@/modules/cv/public"

export const alt = "Anwar's CV"
export const size = ogSize
export const contentType = ogContentType

/** Name and headline from the published CV, so the card says what the page says. Request time (no database at build). */
export default async function Image() {
  await connection()
  const profile = (await getPublicCv().catch(() => null))?.profile
  return ogImage({
    eyebrow: profile?.location ? `Curriculum vitae · ${profile.location}` : "Curriculum vitae",
    title: profile?.fullName && profile.headline ? `${profile.fullName} — ${profile.headline}` : "Anwar — economics student and web developer",
    subtitle: "Experience, education, skills and languages. Printable as a PDF.",
  })
}
