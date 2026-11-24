import { cn } from "@/lib/utils"
import { contactStatusLabels, topicLabels, type ContactStatus, type ContactTopic } from "../schema"

// Same pills as the feedback badges; the type style sits outside cn() (see ../../components/badges.tsx).
const pill = "inline-flex h-5 items-center rounded-md px-1.5 whitespace-nowrap"

export function TopicBadge({ topic }: { topic: ContactTopic }) {
  return (
    <span className={`text-caption ${cn(pill, topic === "other" ? "bg-track text-foreground" : "bg-primary/12 text-text-accent")}`}>
      {topicLabels[topic]}
    </span>
  )
}

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return (
    <span
      className={`text-caption ${cn(
        pill,
        status === "new" && "bg-primary/12 text-text-accent",
        status === "replied" && "bg-secondary text-secondary-foreground",
        status === "archived" && "text-muted-foreground",
      )}`}
    >
      {contactStatusLabels[status]}
    </span>
  )
}
