/**
 * A `%…%` pattern for ILIKE that matches `text` literally: `%`, `_` and `\` in
 * user input are escaped instead of acting as wildcards. The value itself is
 * always sent as a bound parameter, never spliced into SQL.
 */
export function likeContains(text: string) {
  return `%${text.replace(/[\\%_]/g, "\\$&")}%`
}
