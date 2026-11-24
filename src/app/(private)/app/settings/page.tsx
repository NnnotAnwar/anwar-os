import { Suspense } from "react"
import { Page } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { requireViewer } from "@/core/auth"
import { isSessionFresh, listApiTokens } from "@/core/api-tokens/server"
import { getSignInMethods } from "@/core/sign-in-methods"
import { TelegramStatus } from "@/modules/osbot/components/telegram-status"
import { ApiTokens } from "./api-tokens"
import { AssistantUsageSection } from "@/modules/assistant/components/usage-section"
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
        <Suspense fallback={null}>
          <TelegramSection />
        </Suspense>
        <Suspense fallback={null}>
          <ApiTokensSection />
        </Suspense>
        <Suspense fallback={null}>
          <AssistantUsageSection />
        </Suspense>
      </div>
    </Page>
  )
}

async function Methods() {
  const methods = await getSignInMethods()
  // Routes keep their client state across navigations: start over per session.
  return <SignInMethods key={methods.sessionKey} methods={methods} />
}

/** The owner's Telegram bot (osbot); other users have none. */
async function TelegramSection() {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") return null
  return (
    <section aria-labelledby="telegram-heading" className="grid gap-4 md:grid-cols-[14rem_1fr] md:gap-8">
      <div className="grid content-start gap-1">
        <h2 id="telegram-heading" className="font-medium">
          Telegram
        </h2>
        <p className="text-sm text-muted-foreground">
          osbot sends reminders and feedback alerts, and saves what you forward to it.
        </p>
      </div>
      <div className="glass rounded-xl p-5">
        <TelegramStatus />
      </div>
    </section>
  )
}

/** Personal API tokens for Claude (MCP) and Shortcuts; not for demo accounts. */
async function ApiTokensSection() {
  const viewer = await requireViewer()
  if (viewer.role === "demo" || viewer.isAnonymous) return null
  const [tokens, fresh] = await Promise.all([listApiTokens(), isSessionFresh()])
  return (
    <section aria-labelledby="api-tokens-heading" className="grid gap-4 md:grid-cols-[14rem_1fr] md:gap-8">
      <div className="grid content-start gap-1">
        <h2 id="api-tokens-heading" className="font-medium">
          API tokens
        </h2>
        <p className="text-sm text-muted-foreground">
          Let Claude (over MCP) and iPhone Shortcuts read or add your things. Each token acts as you; revoke it any time.
        </p>
      </div>
      <div className="glass rounded-xl p-5">
        <ApiTokens tokens={tokens} fresh={fresh} siteUrl={process.env.BETTER_AUTH_URL ?? ""} />
      </div>
    </section>
  )
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
