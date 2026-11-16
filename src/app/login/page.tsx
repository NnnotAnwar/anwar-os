import { Suspense } from "react"
import Link from "next/link"
import { redirect } from "next/navigation"
import { getViewer } from "@/core/auth"
import { googleSignInEnabled } from "@/lib/auth"
import { safeNext } from "@/lib/safe-next"
import { SignInOptions } from "./sign-in-options"

export const metadata = { title: "Sign in" }

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="grid w-full max-w-sm gap-8">
        <div className="grid gap-2">
          <p className="font-display text-[13px] font-semibold tracking-tight">
            anwar<span className="text-muted-foreground">.os</span>
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in</h1>
          <Suspense fallback={<p className="text-sm text-muted-foreground">This part of the site is private.</p>}>
            <Subtitle searchParams={searchParams} />
          </Suspense>
        </div>
        <div className="glass rounded-xl p-5">
          <Suspense fallback={<SignInOptions googleEnabled={googleSignInEnabled} />}>
            <SignInWithParams searchParams={searchParams} />
          </Suspense>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to the public site
        </Link>
      </div>
    </main>
  )
}

const param = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined)

async function Subtitle({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { reauth } = await searchParams
  return (
    <p className="text-sm text-muted-foreground">
      {param(reauth)
        ? "Confirm it's you: sign in again to change how you sign in."
        : "This part of the site is private."}
    </p>
  )
}

async function SignInWithParams({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const params = await searchParams
  const raw = param(params.next)
  const next = raw ? safeNext(raw) : undefined
  // Already signed in (a valid session, not just a cookie): go straight to the app.
  if (await getViewer()) redirect(next ?? "/app")
  return <SignInOptions next={next} googleEnabled={googleSignInEnabled} errorCode={param(params.error)} />
}
