import { Page } from "@/components/motion"
import { PageHeader } from "@/components/shell/page-header"
import { FeedbackForm } from "../components/feedback-form"

/** Public /feedback. Fully static: the form talks to the server only when it sends. */
export default function PublicFeedbackPage() {
  return (
    <Page>
      {/* A plain page: the public layout provides the frame, <main> and gutters. */}
      <div className="mx-auto grid w-full max-w-2xl gap-4">
        <PageHeader
          eyebrow="Feedback"
          title="Tell me what you think"
          description="A complaint, an idea, a question or a thank-you — it goes straight to me. Three short steps; your name is optional."
        />
        <FeedbackForm />
      </div>
    </Page>
  )
}
