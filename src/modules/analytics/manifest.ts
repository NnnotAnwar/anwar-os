import { ChartBar, Globe, PenNib } from "@/components/icons"
import { defineModule } from "@/core/module"

// Cookie-free page views of the public site, counted on this server
// (POST /api/a → app.record_page_view()). Owner only.
export const analytics = defineModule({
  id: "analytics",
  name: "Analytics",
  description: "Views of your public site per day, top pages, referrers and devices. No cookies, no personal data.",
  icon: ChartBar,
  nav: [{ label: "Analytics", href: "/app/analytics" }],
  tagline: "Who reads the site",
  shortcuts: [
    { label: "Last 7 days", href: "/app/analytics?range=7", icon: ChartBar },
    { label: "Last 90 days", href: "/app/analytics?range=90", icon: ChartBar },
    { label: "Writing", href: "/writing", icon: PenNib, hint: "Your published notes" },
    { label: "Your site", href: "/", icon: Globe, hint: "What visitors see" },
  ],
  access: { demoable: false, public: false },
  widgets: [
    {
      id: "site-views",
      title: "Site views this week",
      load: () => import("./widgets/site-views").then((m) => m.SiteViews),
    },
  ],
  actions: () => import("./actions").then((m) => m.actions),
})
