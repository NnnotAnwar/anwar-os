// schema.org structured data (JSON-LD) for the public site. Pure builders, unit
// tested; src/components/site/json-ld.tsx renders them. Every URL passed in
// must already be absolute (absoluteUrl() at request time).
//
// Rendering: <script type="application/ld+json"> is a data block, so the HTML
// parser never runs it and CSP's script-src doesn't apply to it (no nonce
// needed, nothing reported). The one real risk is owner text ending the
// element early ("</script>"), so serializeJsonLd escapes "<", ">" and "&" as
// \u escapes, which JSON parsers read back unchanged.

type Thing = Record<string, unknown>

const CONTEXT = "https://schema.org"

/** The site owner as the author/subject of the site. One @id, so every page's Person is the same node. */
export const personId = (siteUrl: string) => `${trimSlash(siteUrl)}/#person`
export const websiteId = (siteUrl: string) => `${trimSlash(siteUrl)}/#website`

const trimSlash = (url: string) => url.replace(/\/+$/, "")

/** Only web profiles belong in sameAs (no mailto:/tel:), each once. */
export function profileLinks(urls: readonly (string | null | undefined)[]): string[] {
  const out = new Set<string>()
  for (const raw of urls) {
    if (!raw) continue
    try {
      const url = new URL(raw)
      if (url.protocol === "https:" || url.protocol === "http:") out.add(url.toString())
    } catch {
      // not a URL: skip
    }
  }
  return [...out]
}

/** Drops undefined, null, "" and empty arrays, so optional fields simply don't appear. */
function compact<T extends Thing>(obj: T): T {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)),
  ) as T
}

export type PersonInput = {
  siteUrl: string
  name: string
  jobTitle?: string
  description?: string
  /** e.g. "Prague, Czech Republic". */
  location?: string
  sameAs?: readonly (string | null | undefined)[]
  image?: string
}

export function personJsonLd(p: PersonInput): Thing {
  return compact({
    "@type": "Person",
    "@id": personId(p.siteUrl),
    name: p.name,
    url: trimSlash(p.siteUrl) + "/",
    jobTitle: p.jobTitle,
    description: p.description,
    image: p.image,
    homeLocation: p.location ? { "@type": "Place", name: p.location } : undefined,
    sameAs: p.sameAs ? profileLinks(p.sameAs) : undefined,
  })
}

export function websiteJsonLd({ siteUrl, name, description }: { siteUrl: string; name: string; description: string }): Thing {
  return {
    "@type": "WebSite",
    "@id": websiteId(siteUrl),
    url: trimSlash(siteUrl) + "/",
    name,
    description,
    inLanguage: "en",
    publisher: { "@id": personId(siteUrl) },
  }
}

/** /cv: a ProfilePage about the Person (Google's type for profile pages). */
export function profilePageJsonLd({
  siteUrl,
  url,
  person,
  dateModified,
}: {
  siteUrl: string
  url: string
  person: Thing
  dateModified?: string
}): Thing {
  return compact({
    "@type": "ProfilePage",
    url,
    isPartOf: { "@id": websiteId(siteUrl) },
    dateModified,
    mainEntity: person,
  })
}

export type CaseStudyInput = {
  siteUrl: string
  url: string
  name: string
  description?: string
  image?: string | null
  dateModified: string
  keywords?: readonly string[]
  /** The live product, when there is one. */
  liveUrl?: string | null
}

/** /projects/[slug]: the case study as a CreativeWork by the site owner. */
export function caseStudyJsonLd(c: CaseStudyInput): Thing {
  return compact({
    "@type": "CreativeWork",
    "@id": `${c.url}#case-study`,
    url: c.url,
    name: c.name,
    headline: c.name.slice(0, 110),
    description: c.description,
    image: c.image ?? undefined,
    dateModified: c.dateModified,
    inLanguage: "en",
    keywords: c.keywords?.length ? c.keywords.join(", ") : undefined,
    author: { "@id": personId(c.siteUrl) },
    isPartOf: { "@id": websiteId(c.siteUrl) },
    mainEntityOfPage: c.url,
    sameAs: c.liveUrl ? profileLinks([c.liveUrl]) : undefined,
  })
}

export type ArticleInput = {
  siteUrl: string
  url: string
  headline: string
  description?: string
  image?: string
  datePublished: string
  dateModified: string
  wordCount?: number
}

/** /writing/[slug]: a BlogPosting by the site owner. */
export function articleJsonLd(a: ArticleInput): Thing {
  return compact({
    "@type": "BlogPosting",
    "@id": `${a.url}#article`,
    url: a.url,
    // Google shows at most 110 characters of a headline.
    headline: a.headline.slice(0, 110),
    description: a.description,
    image: a.image,
    datePublished: a.datePublished,
    dateModified: a.dateModified,
    inLanguage: "en",
    wordCount: a.wordCount || undefined,
    author: { "@id": personId(a.siteUrl) },
    publisher: { "@id": personId(a.siteUrl) },
    isPartOf: { "@id": websiteId(a.siteUrl) },
    mainEntityOfPage: a.url,
  })
}

/** Home › Section › Page. Each item's `url` absolute; the last one is the current page. */
export function breadcrumbJsonLd(items: readonly { name: string; url: string }[]): Thing {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: item.url })),
  }
}

/** One document: a single node, or several in an @graph (they reference each other by @id). */
export function jsonLdDocument(nodes: readonly Thing[]): Thing {
  return nodes.length === 1 ? { "@context": CONTEXT, ...nodes[0] } : { "@context": CONTEXT, "@graph": nodes }
}

/**
 * JSON for inside <script type="application/ld+json">. "<", ">" and "&" become
 * <, >, & so owner text can't close the element or open a
 * comment; U+2028/2029 are escaped for old JS-based consumers. JSON.parse
 * returns the original strings.
 */
export function serializeJsonLd(doc: Thing): string {
  return JSON.stringify(doc)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")
}
