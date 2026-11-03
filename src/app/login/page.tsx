import { Suspense } from "react"
import Link from "next/link"
import { LoginForm } from "./login-form"

export const metadata = { title: "Sign in" }

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="grid w-full max-w-sm gap-8">
        <div className="grid gap-2">
          <p className="font-display text-[13px] font-semibold tracking-tight">
            anwar<span className="text-mist">.os</span>
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground">This part of the site is private.</p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <Suspense fallback={<LoginForm />}>
            <LoginFormWithNext searchParams={searchParams} />
          </Suspense>
        </div>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to the public site
        </Link>
      </div>
    </main>
  )
}

async function LoginFormWithNext({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { next } = await searchParams
  return <LoginForm next={typeof next === "string" ? next : undefined} />
}
