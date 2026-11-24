import Link from "next/link"
import { NAV_BACK, Page } from "@/components/motion"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Where a send without JavaScript lands (Post/Redirect/Get). With JavaScript the form shows its own card. */
export default function ContactSentPage() {
  return (
    <Page>
      <div className="glass mx-auto grid w-full max-w-2xl justify-items-center gap-4 rounded-xl p-6 text-center md:p-10">
        <svg viewBox="0 0 56 56" className="size-14" aria-hidden>
          <circle cx="28" cy="28" r="26" className="fill-secondary" />
          <path
            d="M17 29 l7 7 l15 -16"
            fill="none"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-text-accent"
          />
        </svg>
        <div className="grid gap-1.5">
          <h1 className="text-greeting">Thank you</h1>
          <p className="text-meta max-w-prose text-pretty text-muted-foreground">
            Your message reached Anwar. He answers by email to the address you gave, usually within a few days.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/projects" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "max-sm:h-11")}>
            See projects
          </Link>
          <Link href="/" transitionTypes={NAV_BACK} className={cn(buttonVariants({ size: "lg" }), "max-sm:h-11")}>
            Back to the start
          </Link>
        </div>
      </div>
    </Page>
  )
}
