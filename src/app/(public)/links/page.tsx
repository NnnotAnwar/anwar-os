import { pageMetadata } from "@/lib/site"

export { default } from "@/modules/links/routes/public"

export const metadata = pageMetadata({
  title: "Useful links",
  description: "Articles, tools and docs Anwar keeps coming back to, grouped by topic.",
  path: "/links",
})
