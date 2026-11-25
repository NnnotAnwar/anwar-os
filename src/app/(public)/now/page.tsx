import { pageMetadata } from "@/lib/site"

export { default } from "@/modules/now/routes/public"

export const metadata = pageMetadata({
  title: "Now",
  description:
    "What Anwar is focused on right now: this year's goals, the projects he's building and his latest writing, updated from his own data.",
  path: "/now",
})
