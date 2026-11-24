import Link from "next/link"
import { monthlyUsage } from "@/core/ai-usage"
import { requireViewer } from "@/core/auth"
import { modulesFor } from "@/core/module"
import { claudeConfig } from "@/lib/claude"
import { formatTokens, formatUsd } from "@/lib/claude-pricing"
import { modules } from "@/modules/_registry"

/** Settings → "AI assistant": on/off, the models, and one line of this month's usage. */
export async function AssistantUsageSection() {
  const viewer = await requireViewer()
  if (!modulesFor(modules, viewer.role).some((m) => m.id === "assistant")) return null
  const config = claudeConfig()
  const usage = await monthlyUsage(viewer.timezone)
  const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
  const month = new Intl.DateTimeFormat("en", { month: "long", timeZone: viewer.timezone }).format(new Date())

  return (
    <section aria-labelledby="assistant-heading" className="grid gap-4 md:grid-cols-[14rem_1fr] md:gap-8">
      <div className="grid content-start gap-1">
        <h2 id="assistant-heading" className="font-medium">
          AI assistant
        </h2>
        <p className="text-sm text-muted-foreground">Claude answers in the Assistant and reads receipt photos in Budget and the expense bot.</p>
      </div>
      <div className="glass grid gap-2 rounded-xl p-5" data-testid="assistant-usage">
        {config.apiKey ? (
          <p className="text-body">
            On · chat <span className="text-muted-foreground">{config.chatModel}</span>, receipts <span className="text-muted-foreground">{config.receiptModel}</span>
          </p>
        ) : (
          <p className="text-body">
            Off · add <code>ANTHROPIC_API_KEY</code> on the server to switch it on.
          </p>
        )}
        <p className="text-meta text-muted-foreground tabular-nums">
          {month}: {usage.requests} {usage.requests === 1 ? "request" : "requests"} · {formatTokens(tokens)} tokens · ≈ {formatUsd(usage.costMicroUsd)}
          {config.monthlyLimitUsd !== null && ` of $${config.monthlyLimitUsd}`}
        </p>
        <p className="text-caption text-muted-foreground">
          Estimated from list prices; the Anthropic Console has the real bill.{" "}
          <Link href="/app/assistant" className="text-text-accent hover:underline">
            Open the assistant
          </Link>
        </p>
      </div>
    </section>
  )
}
