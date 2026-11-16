import { Suspense } from "react"
import Link from "next/link"
import { headers } from "next/headers"
import { getSessionCookie } from "better-auth/cookies"
import { SignIn, SquaresFour } from "@/components/icons"
import { buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const linkClass = cn(buttonVariants(), "gap-1.5")

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
    <Link href="/login" className={linkClass}>
      <SignIn />
      Sign in
    </Link>
  )
}
