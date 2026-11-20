import { pageMetadata } from "@/lib/site"

export { default } from "@/modules/cv/routes/public"

export const metadata = pageMetadata({
  title: "CV",
  description: "Anwar's résumé: experience, education, skills and languages. Printable as a PDF.",
  path: "/cv",
  type: "profile",
})
