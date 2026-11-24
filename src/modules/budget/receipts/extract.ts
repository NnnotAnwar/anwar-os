import type Anthropic from "@anthropic-ai/sdk"
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod"
import { RECEIPT_SYSTEM, ReceiptError, receiptOutput, type ReceiptImage, type ReceiptOutput } from "./lib"

// One Claude vision call: photo in, structured fields out. The client is passed
// in (claudeClient() in production, a scripted stand-in in tests). Small and
// cheap by design: a fast model at low effort, one short structured answer.

export type ExtractContext = {
  today: string
  timezone: string
  defaultCurrency: string
  categoryNames: string[]
}

export type Extracted = {
  output: ReceiptOutput
  model: string
  usage: Anthropic.Usage
}

/** Thinking is on by default on current models and counts toward this cap. */
const MAX_TOKENS = 4096

export async function extractReceipt(client: Anthropic, model: string, image: ReceiptImage, ctx: ExtractContext): Promise<Extracted> {
  const response = await client.messages.parse({
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: "low", format: zodOutputFormat(receiptOutput) },
    system: RECEIPT_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
          {
            type: "text",
            text: [
              `Today is ${ctx.today} (${ctx.timezone}). Usual currency: ${ctx.defaultCurrency}.`,
              `Categories: ${ctx.categoryNames.join(", ") || "(none)"}.`,
              "Read this receipt.",
            ].join("\n"),
          },
        ],
      },
    ],
  })

  if (response.stop_reason === "refusal") throw new ReceiptError("Claude declined to read that image.")
  if (response.stop_reason === "max_tokens") throw new ReceiptError("I couldn't read that receipt. Try a sharper photo.")
  const output = response.parsed_output
  if (!output) throw new ReceiptError("I couldn't read that receipt. Try a sharper photo.")
  return { output, model: response.model || model, usage: response.usage }
}
