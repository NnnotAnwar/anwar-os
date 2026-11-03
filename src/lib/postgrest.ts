/**
 * Builds a quoted `%…%` ILIKE value for PostgREST `.or()` filters, so user text
 * containing `,` `(` `)` `"` `%` `_` or `\` is matched literally instead of being
 * parsed as filter syntax or LIKE wildcards.
 */
export function ilikeContains(text: string) {
  const likeEscaped = text.replace(/[\\%_]/g, "\\$&")
  const quoted = likeEscaped.replace(/[\\"]/g, "\\$&")
  return `"%${quoted}%"`
}
