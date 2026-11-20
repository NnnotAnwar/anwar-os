import { renderToStaticMarkup } from "react-dom/server"
import { createElement, Fragment } from "react"
import { describe, expect, it } from "vitest"
import { Markdown, markdownOutline, markdownToText, parseBlocks, renderMarkdown, safeHref } from "./markdown"

const html = (source: string) => renderToStaticMarkup(createElement(Fragment, null, renderMarkdown(source)))

describe("parseBlocks", () => {
  it("groups headings, paragraphs, lists, quotes and code", () => {
    const blocks = parseBlocks("# Title\n\nOne\nline\n\n- a\n- b\n\n1. x\n\n> quote\n\n```\ncode\n```")
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "quote", "code"])
    expect(blocks[1]).toEqual({ kind: "paragraph", text: "One line" })
    expect(blocks[2]).toEqual({ kind: "list", ordered: false, items: ["a", "b"] })
  })
})

describe("renderMarkdown", () => {
  it("renders inline emphasis, code and links", () => {
    const out = html("**bold** *it* `x` [site](https://example.com)")
    expect(out).toContain("<strong>bold</strong>")
    expect(out).toContain("<em>it</em>")
    expect(out).toContain(">x</code>")
    expect(out).toContain('href="https://example.com/"')
  })

  it("never produces raw HTML from the source", () => {
    const out = html('<script>alert(1)</script> <img src=x onerror="y">')
    expect(out).not.toContain("<script>")
    expect(out).not.toContain("<img")
    expect(out).toContain("&lt;script&gt;")
  })

  it("drops unsafe link protocols", () => {
    const out = html("[click](javascript:alert(1))")
    expect(out).not.toContain("href")
  })

  it("starts headings at h2 because the page owns the h1", () => {
    expect(html("# Top")).toMatch(/^<h2/)
  })
})

describe("safeHref", () => {
  it("allows web, mail and same-site links only", () => {
    expect(safeHref("https://a.cz")).toBe("https://a.cz/")
    expect(safeHref("mailto:a@b.cz")).toBe("mailto:a@b.cz")
    expect(safeHref("/cv")).toBe("/cv")
    expect(safeHref("//evil.com")).toBeNull()
    expect(safeHref("data:text/html,x")).toBeNull()
  })
})

describe("markdownToText", () => {
  it("strips syntax for previews", () => {
    expect(markdownToText("## Hi\n- **bold** [link](https://x.y)")).toBe("Hi bold link")
  })
})

describe("outline", () => {
  const body = "Intro\n\n## The problem\n\nText\n\n### Plan **A**\n\n## The problem\n\n## Plánuj směny"

  it("lifts the top heading level to h2 and gives every heading a unique id", () => {
    expect(markdownOutline(body)).toEqual([
      { id: "the-problem", text: "The problem", level: 2 },
      { id: "plan-a", text: "Plan A", level: 3 },
      { id: "the-problem-2", text: "The problem", level: 2 },
      { id: "planuj-smeny", text: "Plánuj směny", level: 2 },
    ])
    const out = renderToStaticMarkup(createElement(Markdown, { source: body, outline: true }))
    expect(out).toContain('<h2 id="the-problem"')
    expect(out).toContain('<h3 id="plan-a"')
  })

  it("leaves the default rendering alone", () => {
    expect(html("## Title")).toMatch(/^<h3 class=/)
  })
})
