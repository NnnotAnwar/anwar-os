import "server-only"
import type { SearchHit, SearchProvider } from "@/core/module"
import { excerptAround, matches } from "@/lib/search-text"
import { actions } from "./actions"

/** Matches across the viewer's own CV entries; each hit opens the editor at its section. */
export const search: SearchProvider = async (query, limit) => {
  const has = (...parts: (string | null)[]) => matches(parts.filter(Boolean).join(" \n "), query)
  const about = (text: string | null) => excerptAround(text, query, 80) || undefined
  const meta = (...parts: (string | null)[]) => parts.filter((p): p is string => Boolean(p))
  const cv = await actions.get.handler({})
  const hits: SearchHit[] = [
    ...cv.experience
      .filter((e) => has(e.role, e.organization, e.description))
      .map((e) => ({ id: e.id, title: e.role, snippet: about(e.description), meta: meta("Experience", e.organization), href: "/app/cv#cv-experience" })),
    ...cv.education
      .filter((e) => has(e.institution, e.degree, e.description))
      .map((e) => ({ id: e.id, title: e.institution, snippet: about(e.description), meta: meta("Education", e.degree), href: "/app/cv#cv-education" })),
    ...cv.skills
      .filter((s) => has(s.name, s.category))
      .map((s) => ({ id: s.id, title: s.name, meta: meta("Skill", s.category), href: "/app/cv#cv-skills" })),
    ...cv.languages
      .filter((l) => has(l.name, l.level))
      .map((l) => ({ id: l.id, title: l.name, meta: meta("Language", l.level), href: "/app/cv#cv-languages" })),
  ]
  if (cv.profile && has(cv.profile.fullName, cv.profile.headline, cv.profile.summary)) {
    hits.unshift({
      id: "profile",
      title: cv.profile.headline || cv.profile.fullName || "CV profile",
      snippet: about(cv.profile.summary),
      meta: ["Profile"],
      href: "/app/cv",
    })
  }
  return hits.slice(0, limit)
}
