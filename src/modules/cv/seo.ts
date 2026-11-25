import { personJsonLd } from "@/lib/json-ld"
import type { Cv } from "./schema"

/** The owner's name when the CV isn't published (or has no name yet). */
export const FALLBACK_NAME = "Anwar"

/**
 * The site owner as a schema.org Person, from the published CV: name,
 * headline as job title, location, and the contact links that are web
 * profiles (GitHub, LinkedIn, …) as sameAs. No CV: just the name and site.
 */
export function cvPerson(cv: Cv | null, siteUrl: string, description?: string) {
  const profile = cv?.profile
  return personJsonLd({
    siteUrl,
    name: profile?.fullName || FALLBACK_NAME,
    jobTitle: profile?.headline || undefined,
    description,
    location: profile?.location || undefined,
    sameAs: profile?.contacts.map((c) => c.url) ?? [],
  })
}

/** When the published CV last changed: its profile or any visible entry. */
export function cvUpdatedAt(cv: Cv | null): string | undefined {
  if (!cv?.profile) return undefined
  const dates = [cv.profile, ...cv.experience, ...cv.education, ...cv.skills, ...cv.languages].map((x) => Date.parse(x.updatedAt))
  const max = Math.max(...dates.filter(Number.isFinite))
  return Number.isFinite(max) ? new Date(max).toISOString() : undefined
}
