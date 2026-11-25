import { jsonLdDocument, serializeJsonLd } from "@/lib/json-ld"

/**
 * Structured data for search engines, as one <script type="application/ld+json">.
 * A data block: browsers never execute it and CSP doesn't govern it, so it
 * needs no nonce. serializeJsonLd escapes "<" so owner text can't end the tag.
 */
export function JsonLd({ nodes }: { nodes: readonly Record<string, unknown>[] }) {
  if (nodes.length === 0) return null
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLdDocument(nodes)) }} />
}
