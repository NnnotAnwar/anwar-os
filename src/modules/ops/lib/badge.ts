/** The Ops card's badge: services needing attention and unresolved errors, in one count. */
export function opsBadge(services: number, errors: number): { count: number; label: string } | null {
  const count = services + errors
  if (!count) return null
  if (!errors) return { count, label: services === 1 ? "needs attention" : "need attention" }
  if (!services) return { count, label: errors === 1 ? "error" : "errors" }
  return { count, label: "need attention" }
}
