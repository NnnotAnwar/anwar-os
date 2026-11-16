import Link from "next/link"

/** The anwar.os wordmark. Links to Today inside the app, or wherever `href` says. */
export function Wordmark({ href = "/app" }: { href?: string }) {
  return (
    <Link
      href={href}
      className="rounded-md font-display text-[15px] font-bold tracking-[-0.02em] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      anwar<span className="text-text-accent">.os</span>
    </Link>
  )
}
