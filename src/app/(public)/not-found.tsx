import Link from "next/link"
import { buttonVariants } from "@/components/ui/button"

export default function PublicNotFound() {
  return (
    <div className="glass mx-auto grid w-full max-w-xl justify-items-start gap-3 rounded-xl p-6">
      <p className="text-eyebrow text-text-accent">Not found</p>
      <h1 className="text-greeting">This page isn&apos;t here</h1>
      <p className="text-meta text-muted-foreground">
        It may have been unpublished or moved. Try the projects or start from the beginning.
      </p>
      <div className="flex flex-wrap gap-2">
        <Link href="/" className={buttonVariants({ size: "lg" })}>
          Go to the start
        </Link>
        <Link href="/projects" className={buttonVariants({ variant: "outline", size: "lg" })}>
          See projects
        </Link>
      </div>
    </div>
  )
}
