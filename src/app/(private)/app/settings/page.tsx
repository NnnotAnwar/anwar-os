import { Suspense } from "react"
import { Page } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { getSignInMethods } from "@/core/sign-in-methods"
import { SignInMethods } from "./sign-in-methods"

export const metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-8">
        <PageHeader title="Settings" />
        <section aria-labelledby="sign-in-heading" className="grid gap-4 md:grid-cols-[14rem_1fr] md:gap-8">
          <div className="grid content-start gap-1">
            <h2 id="sign-in-heading" className="font-medium">
              Sign-in methods
            </h2>
            <p className="text-sm text-muted-foreground">
              How you get into anwar.os. A passkey is the fastest way in and can&apos;t be phished.
            </p>
          </div>
          <div className="glass rounded-xl p-5">
            <Suspense fallback={<MethodsSkeleton />}>
              <Methods />
            </Suspense>
          </div>
        </section>
      </div>
    </Page>
  )
}

async function Methods() {
  const methods = await getSignInMethods()
  // Routes keep their client state across navigations: start over per session.
  return <SignInMethods key={methods.sessionKey} methods={methods} />
}

function MethodsSkeleton() {
  return (
    <div className="grid gap-5">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
      ))}
    </div>
  )
}
