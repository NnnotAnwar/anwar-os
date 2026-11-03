import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"

// Placeholder landing. The real About / Projects / Links pages come in phase 1 (MDX).
export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-6 px-4 py-24">
      <p className="text-sm font-medium text-muted-foreground">Prague · Web developer</p>
      <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        Hi, I&apos;m Anwar. I build products at the edge of business and code.
      </h1>
      <p className="max-w-prose text-lg text-pretty text-muted-foreground">
        Projects, writing and live demos are on the way. This site is also my personal
        operating system, so most of it is private.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          Owner sign in
        </Link>
      </div>
    </main>
  )
}
