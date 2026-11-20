import { pageMetadata } from "@/lib/site"

export { default } from "@/modules/projects/routes/public-index"

export const metadata = pageMetadata({
  title: "Projects",
  description: "Products, experiments and coursework by Anwar, with case studies and live demos.",
  path: "/projects",
})
