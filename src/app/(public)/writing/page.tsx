import { pageMetadata } from "@/lib/site"

export { default } from "@/modules/notes/routes/public-index"

export const metadata = pageMetadata({
  title: "Writing",
  description: "Notes Anwar chose to publish: building products, studying economics and self-hosting.",
  path: "/writing",
})
