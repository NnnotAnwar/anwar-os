import { Suspense } from "react"
import { Page } from "@/components/motion"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shell/page-header"
import { asViewer, requireViewer } from "@/core/auth"
import { isSessionFresh, listApiTokens } from "@/core/api-tokens/server"
import { getSignInMethods } from "@/core/sign-in-methods"
import { getTheme } from "@/core/preferences"
import { AppearanceSettings } from "./appearance-settings"
import { TelegramStatus } from "@/modules/osbot/components/telegram-status"
import { BriefSettings } from "@/modules/osbot/components/brief-settings"
import { readBriefSettings } from "@/modules/osbot/brief"
import { ApiTokens } from "./api-tokens"
import { AssistantUsageSection } from "@/modules/assistant/components/usage-section"
import { SignInMethods } from "./sign-in-methods"

export const metadata = { title: "Settings" }

export default function SettingsPage() {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-3xl grid-cols-1 gap-8">
        <PageHeader title="Settings" />
        <section aria-labelledby="sign-in-heading" className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
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
        <section
          id="appearance"
          aria-labelledby="appearance-heading"
          className="grid scroll-mt-20 gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8"
        >
          <div className="grid content-start gap-1">
            <h2 id="appearance-heading" className="font-medium">
              Appearance
            </h2>
            <p className="text-sm text-muted-foreground">
              Light, dark, or dark at night on a schedule. Saved for you, so every device and the public site follow it.
            </p>
          </div>
          <div className="glass rounded-xl p-5">
            <Suspense fallback={<Skeleton className="h-40 w-full" />}>
              <Appearance />
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

async function Appearance() {
  const [viewer, { place }] = await Promise.all([requireViewer(), getTheme()])
  return <AppearanceSettings place={place} timeZone={viewer.timezone} locale={viewer.locale} />
}

/** The owner's Telegram bot (osbot); other users have none. */
async function TelegramSection() {
  const viewer = await requireViewer()
  if (viewer.role !== "owner") return null
  return (
    <section aria-labelledby="telegram-heading" className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
      <div className="grid content-start gap-1">
        <h2 id="telegram-heading" className="font-medium">
          Telegram
        </h2>
        <p className="text-sm text-muted-foreground">
          osbot sends reminders, alerts and a morning brief, and saves what you forward to it.
        </p>
      </div>
      <div className="glass grid gap-5 rounded-xl p-5">
        <TelegramStatus />
        <div className="border-t border-border/60 pt-5">
          <BriefSettings settings={await asViewer(readBriefSettings)} timezone={viewer.timezone} />
        </div>
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
    <section aria-labelledby="api-tokens-heading" className="grid gap-4 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-8">
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

/** Shaped like SignInMethods (password, passkeys, two-factor rows), so the sections below stay put. */
function MethodsSkeleton() {
  const rows = [
    { lines: 1, action: false },
    { lines: 2, action: true },
    { lines: 3, action: true },
  ]
  return (
    <div className="grid" aria-hidden>
      {rows.map((row, i) => (
        <div key={i} className="grid gap-3 border-b border-border/60 py-4 first:pt-0 last:border-b-0 last:pb-0">
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 shrink-0 rounded-lg" />
            <div className="grid flex-1 gap-1.5 pt-0.5">
              <Skeleton className="h-4 w-28" />
              {Array.from({ length: row.lines }, (_, j) => (
                <Skeleton key={j} className={j === row.lines - 1 ? "h-3.5 w-2/3" : "h-3.5 w-full"} />
              ))}
            </div>
          </div>
          {row.action && <Skeleton className="h-9 w-36 rounded-lg sm:ml-12" />}
        </div>
      ))}
    </div>
  )
}
