/** "24 Nov 2026": a publish date on the public site, in the owner's time zone. */
export function formatPublished(iso: string, timeZone = "Europe/Prague") {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso),
  )
}
