import { Suspense } from "react"
import { Page } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { requireViewer } from "@/core/auth"
import { MfaSettings } from "./mfa-settings"

export const metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl gap-8">
        <PageHeader title="Settings" />
        <section aria-labelledby="security-heading" className="grid gap-4 md:grid-cols-[14rem_1fr] md:gap-8">
          <div className="grid content-start gap-1">
            <h2 id="security-heading" className="font-medium">
              Two-factor sign-in
            </h2>
            <p className="text-sm text-muted-foreground">
              Ask for a 6-digit code from an authenticator app every time you sign in.
            </p>
          </div>
          <div className="glass rounded-xl p-5">
            <Suspense fallback={<Skeleton className="h-8 w-44" />}>
              <MfaStatus />
            </Suspense>
          </div>
        </section>
      </div>
    </Page>
  )
}

async function MfaStatus() {
  const viewer = await requireViewer()
  return <MfaSettings enabled={viewer.twoFactorEnabled} />
}
