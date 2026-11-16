import { MessageSquare } from "@/components/icons"
import { defineModule } from "@/core/module"

export const feedback = defineModule({
  id: "feedback",
  name: "Feedback",
  description: "Complaints, suggestions and questions visitors send through the public form.",
  icon: MessageSquare,
  nav: [{ label: "Feedback", href: "/app/feedback" }],
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
