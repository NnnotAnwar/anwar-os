import Link from "next/link"

export function Wordmark() {
  return (
    <Link
      href="/app"
      className="rounded-md font-display text-[13px] font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      anwar<span className="text-mist">.os</span>
    </Link>
  )
}
