import Link from "next/link"
import { cn } from "@/lib/utils"

/** The anwar.os wordmark. Links to Today inside the app, or wherever `href` says. */
export function Wordmark({ href = "/app", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      aria-label={href === "/" ? "anwar.os home" : undefined}
      className={cn(
        "rounded-md font-display text-[15px] font-bold tracking-[-0.02em] outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      anwar<span className="text-text-accent">.os</span>
    </Link>
  )
}
