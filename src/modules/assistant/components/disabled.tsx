import { Sparkle } from "@/components/icons"

/** The assistant without ANTHROPIC_API_KEY: what it is and the exact steps to switch it on. */
export function AssistantDisabled() {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-4 pt-6" data-testid="assistant-disabled">
      <div className="glass grid gap-4 rounded-xl p-5 [--glass-shadow:var(--shadow-glass-lg)]">
        <span className="grid size-10 place-items-center rounded-lg bg-accent-500/12 text-text-accent">
          <Sparkle className="size-5" />
        </span>
        <div className="grid gap-1.5">
          <p className="text-eyebrow text-text-accent">Assistant is off</p>
          <h1 className="text-card-title">Add ANTHROPIC_API_KEY on the server</h1>
          <p className="text-body text-muted-foreground">
            The assistant (and reading receipt photos in Budget and the expense bot) calls Claude from the server. It switches on as soon as the web app has an Anthropic API key.
          </p>
        </div>
        <ol className="text-meta grid list-decimal gap-1.5 pl-5 text-muted-foreground">
          <li>
            Create a key at <span className="text-foreground">console.anthropic.com</span> → API keys.
          </li>
          <li>
            Add <code className="text-foreground">ANTHROPIC_API_KEY=sk-ant-…</code> to <code className="text-foreground">/opt/anwar-os/repo/infra/.env</code>.
          </li>
          <li>
            Recreate web: <code className="text-foreground">dc up -d web</code>.
          </li>
        </ol>
        <p className="text-caption text-muted-foreground">Optional: ASSISTANT_MODEL, ASSISTANT_MONTHLY_LIMIT_USD. Details in docs/DEPLOY.md, “AI assistant”.</p>
      </div>
    </div>
  )
}
