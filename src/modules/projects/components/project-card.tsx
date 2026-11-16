import Link from "next/link"
import { ArrowUpRight } from "@/components/icons"
import type { PublicProject } from "../schema"
import { StatusPill } from "./status-pill"

/** Public grid card: optional cover, title, summary, stack. The whole card is the link. */
export function ProjectCard({ project, headingLevel = "h2" }: { project: PublicProject; headingLevel?: "h2" | "h3" }) {
  const Heading = headingLevel
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group glass grid h-full content-start overflow-hidden rounded-xl outline-none transition-shadow hover:[--glass-shadow:var(--shadow-glass-lg)] focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {project.coverUrl && (
        // Owner-supplied hosts: next/image would need each one allow-listed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={project.coverUrl}
          alt=""
          loading="lazy"
          className="aspect-video w-full border-b border-hairline object-cover"
        />
      )}
      <div className="grid gap-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <Heading className="text-card-title">{project.title}</Heading>
          <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-text-accent" />
        </div>
        {project.summary && <p className="text-meta text-pretty text-muted-foreground">{project.summary}</p>}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <StatusPill status={project.status} />
          {project.stack.slice(0, 4).map((tag) => (
            <span key={tag} className="text-caption rounded-md border border-hairline px-1.5 py-0.5 text-muted-foreground">
              {tag}
            </span>
          ))}
          {project.stack.length > 4 && (
            <span className="text-caption text-muted-foreground tabular-nums">+{project.stack.length - 4}</span>
          )}
        </div>
      </div>
    </Link>
  )
}
