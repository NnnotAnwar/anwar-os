import Link from "next/link"
import { Wordmark } from "@/components/shell/wordmark"

// Scoped to /tools so the landing page keeps its own frame. Fully static: no
// session, no database.
export default function PublicToolsLayout({ children }: LayoutProps<"/tools">) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 md:px-8">
          <Wordmark href="/" />
          <span className="text-muted-foreground/50" aria-hidden>
            /
          </span>
          <Link
            href="/tools"
            className="rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Tools
          </Link>
        </div>
      </header>
      <main className="w-full flex-1 px-4 pt-6 pb-16 md:px-8 md:pt-10">{children}</main>
    </div>
  )
}
