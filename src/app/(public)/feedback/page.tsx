import { pageMetadata } from "@/lib/site"

export { default } from "@/modules/feedback/routes/public"

export const metadata = pageMetadata({
  title: "Feedback",
  description: "Send Anwar a complaint, a suggestion, a question or a thank-you. Anonymous is fine.",
  path: "/feedback",
})
