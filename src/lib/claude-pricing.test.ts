import { describe, expect, it } from "vitest"
import { costMicroUsd, formatTokens, formatUsd, tokenCounts } from "./claude-pricing"

describe("claude pricing", () => {
  it("reads the SDK usage object", () => {
    expect(tokenCounts({ input_tokens: 10, output_tokens: 2, cache_read_input_tokens: null })).toEqual({
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    })
  })

  it("estimates cost in micro-dollars from list prices", () => {
    // Sonnet 5.5: 1M input $2 + 100k output $1 + 1M cache reads $0.10 + 100k cache writes $0.25
    expect(costMicroUsd("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000 })).toBe(3_350_000)
    // Haiku 5.5 receipt: 1500 in, 80 out
    expect(costMicroUsd("claude-haiku-5-5", { inputTokens: 1500, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(190)
    // Unknown models are priced like Sonnet 5.5.
    expect(costMicroUsd("claude-new", { inputTokens: 1000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(2000)
  })

  it("formats for the Settings line", () => {
    expect(formatUsd(0)).toBe("$0.00")
    expect(formatUsd(190)).toBe("<$0.01")
    expect(formatUsd(3_350_000)).toBe("$3.35")
    expect(formatTokens(950)).toBe("950")
    expect(formatTokens(12_300)).toBe("12.3k")
    expect(formatTokens(1_250_000)).toBe("1.25M")
    expect(formatTokens(2_000_000)).toBe("2M")
  })
})
