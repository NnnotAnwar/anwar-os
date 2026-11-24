import { Envelope, Globe, Hammer, Inbox, MessageSquare } from "@/components/icons"
import { defineModule } from "@/core/module"

export const feedback = defineModule({
  id: "feedback",
  name: "Feedback",
  description:
    "Complaints, suggestions and questions visitors send through the public form, and job offers and projects from the contact form.",
  icon: MessageSquare,
  nav: [{ label: "Feedback", href: "/app/feedback" }],
  tagline: "What people tell you",
  badge: () => import("./badge").then((b) => b.badge),
  shortcuts: [
    { label: "Inbox", href: "/app/feedback", icon: Inbox },
    { label: "In progress", href: "/app/feedback?status=in_progress", icon: Hammer },
    { label: "Contact", href: "/app/feedback/contact", icon: Envelope, hint: "Job offers and projects" },
    { label: "Public form", href: "/feedback", icon: Globe, hint: "Share this link" },
  ],
  // The inbox is the site owner's alone.
  access: { demoable: false, public: false },
  widgets: [
    {
      id: "new",
      title: "New feedback",
      load: () => import("./widgets/feedback-widgets").then((m) => m.NewFeedback),
    },
  ],
  search: () => import("./search").then((m) => m.search),
  actions: () => import("./actions").then((m) => m.actions),
})
