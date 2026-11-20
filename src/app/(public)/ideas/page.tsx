import { pageMetadata } from "@/lib/site"

export { default } from "@/modules/ideas/routes/public-index"

export const metadata = pageMetadata({
  title: "Ideas",
  description: "Ideas Anwar is exploring, building or has shipped.",
  path: "/ideas",
})
