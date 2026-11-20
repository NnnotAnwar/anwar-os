import Link from "next/link"
import { ArrowUpRight } from "@/components/icons"
import { NAV_FORWARD, Page } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { TOOLS } from "../catalog"

export type ToolsBase = "/tools" | "/app/tools"

/** The list of calculators. Shared by the public /tools page and /app/tools. */
export function ToolsIndex({ base }: { base: ToolsBase }) {
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-5xl gap-8">
        <PageHeader
          eyebrow="Tools"
          title="Small calculators"
          description="They run entirely in your browser. Nothing you enter is sent anywhere."
        />
        <ul className="grid gap-3 sm:grid-cols-2">
          {TOOLS.map((tool) => (
            <li key={tool.slug}>
              <Link
                href={`${base}/${tool.slug}`}
                transitionTypes={NAV_FORWARD}
                className="press group glass grid h-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 rounded-xl p-4 outline-none transition-shadow hover:[--glass-shadow:var(--shadow-glass-lg)] focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-5"
              >
                <span className="row-span-2 flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <tool.icon className="size-5" aria-hidden />
                </span>
                <span className="text-card-title">{tool.title}</span>
                <ArrowUpRight
                  className="row-span-2 size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-text-accent"
                  aria-hidden
                />
                <span className="text-meta text-pretty text-muted-foreground">{tool.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Page>
  )
}
