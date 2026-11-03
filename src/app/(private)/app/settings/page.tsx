import { PageHeader } from "@/components/shell/page-header"
import { MfaSettings } from "./mfa-settings"

export const metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
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
        <div className="rounded-xl border bg-card p-5">
          <MfaSettings />
        </div>
      </section>
    </div>
  )
}
