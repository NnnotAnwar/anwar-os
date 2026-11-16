import { Suspense } from "react"
import { MfaForm } from "./mfa-form"

export const metadata = { title: "Two-factor sign-in" }

export default function MfaPage({ searchParams }: PageProps<"/login/mfa">) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="grid w-full max-w-sm gap-8">
        <div className="grid gap-2">
          <p className="font-display text-[13px] font-semibold tracking-tight">
            anwar<span className="text-mist">.os</span>
          </p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">One more step</h1>
          <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <Suspense fallback={<MfaForm />}>
            <MfaFormWithNext searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </main>
  )
}

async function MfaFormWithNext({ searchParams }: Pick<PageProps<"/login/mfa">, "searchParams">) {
  const { next } = await searchParams
  return <MfaForm next={typeof next === "string" ? next : undefined} />
}
