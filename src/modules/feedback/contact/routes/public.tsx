import { connection } from "next/server"
import { Page } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { ContactForm } from "../components/contact-form"
import { noScriptNotices, type NoScriptNotice } from "../schema"
import { getContactToken } from "../submit"

/**
 * Public /contact. Rendered per request, outside any Suspense boundary on
 * purpose: the form carries a fresh spam-check token, and a notice after a
 * send without JavaScript (?error=…) must be in the HTML itself, since a
 * streamed boundary needs a script to appear.
 */
export default async function PublicContactPage({ searchParams }: PageProps<"/contact">) {
  await connection()
  const { error } = await searchParams
  const notice = typeof error === "string" && error in noScriptNotices ? noScriptNotices[error as NoScriptNotice] : undefined
  const token = await getContactToken()
  return (
    <Page>
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <PageHeader
          eyebrow="Contact"
          title="Let’s work together"
          description="A job offer, a freelance project, or anything else that needs a reply. I answer by email, usually within a few days."
        />
        <ContactForm token={token} notice={notice} />
      </div>
    </Page>
  )
}
