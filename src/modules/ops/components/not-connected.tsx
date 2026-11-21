import { Plugs } from "@/components/icons"
import type { Offline } from "../schema"

/** Shown instead of the cards when the agent isn't configured or can't be reached. */
export function NotConnected({ offline }: { offline: Offline }) {
  const configured = offline.reason !== "not_configured"
  return (
    <section className="glass grid gap-3 rounded-xl p-4 sm:p-5" aria-labelledby="not-connected-title">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-text-accent">
          <Plugs className="size-5" />
        </span>
        <div className="grid min-w-0 gap-1">
          <h2 id="not-connected-title" className="text-card-title">
            {configured ? "Can't reach the control panel agent" : "Control panel not connected"}
          </h2>
          <p className="text-meta text-muted-foreground">
            {offline.reason === "not_configured" &&
              "This server has no ops-agent configured, so there are no services to show. Nothing is broken: the rest of the app works as usual."}
            {offline.reason === "unauthorized" &&
              "The agent refused the request signature. OPS_AGENT_SECRET must be the same for web and ops-agent."}
            {(offline.reason === "unreachable" || offline.reason === "error") &&
              `${offline.message} Is the ops-agent container running?`}
          </p>
        </div>
      </div>
      {!configured ? (
        <ol className="text-meta grid list-decimal gap-1 pl-5 text-muted-foreground marker:text-text-accent">
          <li>
            In <code className="text-foreground">infra/.env</code>: set <code className="text-foreground">OPS_AGENT_SECRET</code>{" "}
            (<code>openssl rand -hex 32</code>) and <code className="text-foreground">OPS_AGENT_URL=http://ops-agent:8080</code>.
          </li>
          <li>
            Add <code className="text-foreground">ops</code> to <code className="text-foreground">COMPOSE_PROFILES</code>, then run{" "}
            <code className="text-foreground">deploy.sh</code> with the current sha.
          </li>
          <li>Reload this page. docs/DEPLOY.md, “Control panel”, has the details.</li>
        </ol>
      ) : (
        <p className="text-caption text-muted-foreground">
          On the server: <code className="text-foreground">dc ps ops-agent</code> and <code className="text-foreground">dc logs ops-agent</code>.
        </p>
      )}
    </section>
  )
}
