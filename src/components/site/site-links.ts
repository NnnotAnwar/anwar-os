import { Briefcase, Calculator, ChatText, Envelope, IdCard, Lightbulb, LinkIcon, PenNib } from "@/components/icons"

// The public site's sections. Some (links, feedback) are built by other modules.
// `hint` is the one-line promise shown in the phone menu.
export const siteLinks = [
  { href: "/cv", label: "CV", hint: "Experience, education, skills", icon: IdCard },
  { href: "/projects", label: "Projects", hint: "Case studies and live demos", icon: Briefcase },
  { href: "/writing", label: "Writing", hint: "Notes I chose to publish", icon: PenNib },
  { href: "/ideas", label: "Ideas", hint: "What I'm exploring and building", icon: Lightbulb },
  { href: "/links", label: "Links", hint: "Articles and tools I come back to", icon: LinkIcon },
  { href: "/tools", label: "Tools", hint: "Calculators that run in your browser", icon: Calculator },
  { href: "/feedback", label: "Feedback", hint: "Send me a note — anonymous is fine", icon: ChatText },
  { href: "/contact", label: "Contact", hint: "Job offers and projects — I reply by email", icon: Envelope },
] as const

export function isActive(pathname: string | null, href: string) {
  return pathname !== null && (pathname === href || pathname.startsWith(`${href}/`))
}
