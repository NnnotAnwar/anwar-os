import { describe, expect, it, vi } from "vitest"
import { decodeImage, sniffImage } from "@/lib/image-data"
import { extractReceipt } from "./extract"
import { decodeReceiptImage, normalizeCurrency, normalizeReceipt, pickAccount, receiptNote, ReceiptError, toMinorUnits, type ReceiptOutput } from "./lib"

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString("base64")
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64")

const categories = [
  { id: "food", name: "Food" },
  { id: "out", name: "Eating out" },
]
const ctx = { today: "2026-11-24", defaultCurrency: "CZK", categories }
const raw = (over: Partial<ReceiptOutput> = {}): ReceiptOutput => ({
  is_receipt: true,
  total: 312.5,
  currency: "CZK",
  merchant: "  Albert   Hypermarket ",
  date: "2026-11-23",
  category: "food",
  summary: "groceries",
  ...over,
})

describe("images", () => {
  it("knows images by their first bytes, not by what the sender claims", () => {
    expect(sniffImage(Buffer.from(JPEG, "base64"))).toBe("image/jpeg")
    expect(sniffImage(Buffer.from(PNG, "base64"))).toBe("image/png")
    expect(sniffImage(Buffer.from("GIF89a"))).toBe("image/gif")
    expect(sniffImage(Buffer.from("RIFF0000WEBPVP8 "))).toBe("image/webp")
    expect(sniffImage(Buffer.from("%PDF-1.7"))).toBeNull()
  })

  it("accepts base64 and data: URLs, refuses the rest", () => {
    expect(decodeImage(`data:image/png;base64,${JPEG}`)).toMatchObject({ mediaType: "image/jpeg", data: JPEG })
    expect(() => decodeImage("not base64!")).toThrow("That isn't an image.")
    expect(() => decodeImage(Buffer.from("hello world").toString("base64"))).toThrow("Send a JPEG, PNG, WebP or GIF photo.")
    expect(() => decodeImage(JPEG, 4)).toThrow("too large")
    expect(() => decodeReceiptImage("???")).toThrow(ReceiptError)
  })
})

describe("normalizeReceipt", () => {
  it("turns what Claude read into a draft expense", () => {
    expect(normalizeReceipt(raw(), ctx)).toEqual({
      ok: true,
      fields: {
        amountMinor: 31250,
        currency: "CZK",
        merchant: "Albert Hypermarket",
        summary: "groceries",
        occurredOn: "2026-11-23",
        dateAssumed: false,
        categoryId: "food",
        categoryName: "Food",
      },
    })
  })

  it("assumes today for a missing, future or very old date", () => {
    for (const date of [null, "2026-11-30", "2024-01-01", "2026-02-30", "23.11.2026"]) {
      const r = normalizeReceipt(raw({ date }), ctx)
      expect(r.ok && r.fields).toMatchObject({ occurredOn: "2026-11-24", dateAssumed: true })
    }
  })

  it("refuses non-receipts and receipts without a total", () => {
    expect(normalizeReceipt(raw({ is_receipt: false }), ctx)).toMatchObject({ ok: false, reason: "not_receipt" })
    expect(normalizeReceipt(raw({ total: null }), ctx)).toMatchObject({ ok: false, reason: "no_total" })
    expect(normalizeReceipt(raw({ total: 0 }), ctx)).toMatchObject({ ok: false, reason: "no_total" })
  })

  it("leaves an unknown category empty and keeps a negative total positive", () => {
    const r = normalizeReceipt(raw({ category: "Groceries", total: -99.9 }), ctx)
    expect(r.ok && r.fields).toMatchObject({ categoryId: null, amountMinor: 9990 })
  })

  it("normalises currencies", () => {
    expect(normalizeCurrency("kč", "EUR")).toBe("CZK")
    expect(normalizeCurrency("€", "CZK")).toBe("EUR")
    expect(normalizeCurrency("eur", "CZK")).toBe("EUR")
    expect(normalizeCurrency("euro", "CZK")).toBe("CZK")
    expect(normalizeCurrency(null, "CZK")).toBe("CZK")
    expect(toMinorUnits(1500, "JPY")).toBe(1500)
    expect(toMinorUnits(12.345, "EUR")).toBe(1235)
  })

  it("picks an account in the receipt's currency, else the default with a warning", () => {
    const accounts = [
      { id: "czk", currency: "CZK" },
      { id: "eur", currency: "EUR" },
    ]
    expect(pickAccount(accounts, "czk", "CZK")).toEqual({ account: accounts[0], currencyMismatch: false })
    expect(pickAccount(accounts, "czk", "EUR")).toEqual({ account: accounts[1], currencyMismatch: false })
    expect(pickAccount(accounts, "czk", "USD")).toEqual({ account: accounts[0], currencyMismatch: true })
    expect(pickAccount([], null, "CZK")).toEqual({ account: null, currencyMismatch: false })
    expect(receiptNote({ merchant: null, summary: "coffee" })).toBe("coffee")
  })
})

describe("extractReceipt (mocked SDK)", () => {
  const image = { data: JPEG, mediaType: "image/jpeg" as const }
  const extractCtx = { today: "2026-11-24", timezone: "Europe/Prague", defaultCurrency: "CZK", categoryNames: ["Food", "Eating out"] }

  function client(response: Record<string, unknown>) {
    const parse = vi.fn(async () => ({ model: "claude-haiku-5-5", usage: { input_tokens: 1500, output_tokens: 80 }, ...response }))
    return { client: { messages: { parse } } as never, parse }
  }

  it("sends the photo with the owner's categories and returns the parsed fields", async () => {
    const { client: c, parse } = client({ stop_reason: "end_turn", parsed_output: raw() })
    const result = await extractReceipt(c, "claude-haiku-5-5", image, extractCtx)
    expect(result.output.total).toBe(312.5)
    expect(result.model).toBe("claude-haiku-5-5")
    const [params] = parse.mock.calls[0] as unknown as [Record<string, unknown>]
    expect(params).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low" } })
    const content = (params.messages as { content: { type: string; text?: string }[] }[])[0]!.content
    expect(content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG } })
    expect(content[1]!.text).toContain("Categories: Food, Eating out.")
    expect(content[1]!.text).toContain("Today is 2026-11-24")
    expect((params.output_config as { format: { type: string } }).format.type).toBe("json_schema")
  })

  it("turns refusals, cut-offs and unparseable answers into a readable error", async () => {
    for (const response of [{ stop_reason: "refusal", parsed_output: null }, { stop_reason: "max_tokens", parsed_output: null }, { stop_reason: "end_turn", parsed_output: null }]) {
      await expect(extractReceipt(client(response).client, "m", image, extractCtx)).rejects.toBeInstanceOf(ReceiptError)
    }
  })
})
