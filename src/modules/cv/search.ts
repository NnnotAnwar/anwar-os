import "server-only"
import type { SearchHit, SearchProvider } from "@/core/module"
import { actions } from "./actions"

/** Matches across CV entries; each hit opens the editor at its section. */
export const search: SearchProvider = async (query, limit) => {
  const q = query.toLowerCase()
  const has = (...parts: (string | null)[]) => parts.some((p) => p?.toLowerCase().includes(q))
  const cv = await actions.get.handler({})
  const hits: SearchHit[] = [
    ...cv.experience
      .filter((e) => has(e.role, e.organization, e.description))
      .map((e) => ({ id: e.id, title: e.role, snippet: ["Experience", e.organization].filter(Boolean).join(" · "), href: "/app/cv#cv-experience" })),
    ...cv.education
      .filter((e) => has(e.institution, e.degree, e.description))
      .map((e) => ({ id: e.id, title: e.institution, snippet: ["Education", e.degree].filter(Boolean).join(" · "), href: "/app/cv#cv-education" })),
    ...cv.skills
      .filter((s) => has(s.name, s.category))
      .map((s) => ({ id: s.id, title: s.name, snippet: ["Skill", s.category].filter(Boolean).join(" · "), href: "/app/cv#cv-skills" })),
    ...cv.languages
      .filter((l) => has(l.name, l.level))
      .map((l) => ({ id: l.id, title: l.name, snippet: ["Language", l.level].filter(Boolean).join(" · "), href: "/app/cv#cv-languages" })),
  ]
  if (cv.profile && has(cv.profile.fullName, cv.profile.headline, cv.profile.summary)) {
    hits.unshift({ id: "profile", title: cv.profile.headline || "CV profile", snippet: "Profile", href: "/app/cv" })
  }
  return hits.slice(0, limit)
}
