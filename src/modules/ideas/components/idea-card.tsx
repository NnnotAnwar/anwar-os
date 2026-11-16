import { Markdown } from "@/lib/markdown"
import { ideaStatusLabels, type PublicIdea } from "../schema"
import { IdeaStatusPill } from "./idea-status"

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Prague" })

export function IdeaCard({ idea, compact }: { idea: PublicIdea; compact?: boolean }) {
  return (
    <article className="glass grid h-full content-start gap-2 rounded-xl p-4">
      <div className="flex items-center gap-2">
        <IdeaStatusPill status={idea.status} />
        <time dateTime={idea.updatedAt} className="text-caption ml-auto text-muted-foreground tabular-nums">
          <span className="sr-only">{ideaStatusLabels[idea.status]}, updated </span>
          {dateFormat.format(new Date(idea.updatedAt))}
        </time>
      </div>
      <h3 className="text-card-title text-pretty">{idea.title}</h3>
      {idea.body.trim() &&
        (compact ? null : <Markdown source={idea.body} className="text-meta text-muted-foreground [&_p]:leading-6" />)}
      {idea.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 pt-1" aria-label="Tags">
          {idea.tags.map((tag) => (
            <li key={tag} className="text-caption rounded-md border border-hairline px-1.5 py-0.5 text-muted-foreground">
              {tag}
            </li>
          ))}
        </ul>
      )}
    </article>
  )
}
