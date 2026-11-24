import { ChatText, Plus, Sparkle } from "@/components/icons"
import { defineModule } from "@/core/module"

// AI chat over the other modules' actions (Claude). Server-side only; off
// until ANTHROPIC_API_KEY is set (the page then says how to switch it on).
// It has no actions of its own: it *uses* everyone else's (tools.ts).
export const assistant = defineModule({
  id: "assistant",
  name: "Assistant",
  description: "Ask about your tasks, calendar, money and notes, or have Claude add things for you (you confirm every change).",
  tagline: "Claude, with your data",
  icon: Sparkle,
  nav: [{ label: "Assistant", href: "/app/assistant" }],
  shortcuts: [
    { label: "New chat", href: "/app/assistant", icon: Plus },
    { label: "What's on today?", href: "/app/assistant?q=What%27s%20on%20today%3F", icon: ChatText, hint: "Tasks and events for today" },
  ],
  access: { demoable: false, public: false },
  create: { label: "New chat", href: "/app/assistant" },
})
