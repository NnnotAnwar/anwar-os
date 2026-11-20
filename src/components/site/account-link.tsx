import { Suspense } from "react"
import Link from "next/link"
import { headers } from "next/headers"
import { getSessionCookie } from "better-auth/cookies"
import { SignIn, SquaresFour } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

// 44px on phones (touch floor), the compact 32px bar height from 768px.
const linkClass = cn(buttonVariants(), "gap-1.5 max-md:h-11 max-md:px-3.5")
// Visitors don't sign in, so "Sign in" stays quiet and the page's own primary
// action (Read the CV, Send feedback) is the one filled button on screen.
const quietClass = cn(buttonVariants({ variant: "ghost" }), "gap-1.5 text-muted-foreground max-md:h-11 max-md:px-3")

/**
 * "Sign in" in the public header, or "Open app" when a session cookie is
 * present. Prerenders as "Sign in"; the session check streams in. A stale cookie
 * is harmless: /app validates the session and sends the visitor to /login.
 */
export function AccountLink({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Suspense fallback={<SignInLink />}>
        <SessionAware />
      </Suspense>
    </div>
  )
}

async function SessionAware() {
  const hasSession = Boolean(getSessionCookie(await headers()))
  if (!hasSession) return <SignInLink />
  return (
    <Link href="/app" className={linkClass}>
      <SquaresFour />
      Open app
    </Link>
  )
}

function SignInLink() {
  return (
    <Link href="/login" className={quietClass}>
      <SignIn />
      Sign in
    </Link>
  )
}
