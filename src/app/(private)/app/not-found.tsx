import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"

export default function AppNotFound() {
  return (
    <div className="mx-auto grid w-full max-w-xl justify-items-start gap-4 py-12">
      <p className="font-mono text-xs tracking-wider text-muted-foreground uppercase">Not found</p>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Nothing lives at this address</h1>
      <p className="text-muted-foreground">
        It may have been deleted, or the link is incomplete. Search with ⌘K to find what you were after.
      </p>
      <div className="flex gap-2">
        <Link href="/app" className={buttonVariants()}>
          Go to Today
        </Link>
        <Link href="/app/notes" className={buttonVariants({ variant: "outline" })}>
          Open Notes
        </Link>
      </div>
    </div>
  )
}
