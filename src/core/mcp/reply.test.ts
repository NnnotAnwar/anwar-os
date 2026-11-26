import { createMcpHandler, McpServer } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { callsTool, finishReply } from "./reply"

const post = (body: unknown) =>
  new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(body),
  })

const toolCall = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "save", arguments: {} } }

describe("callsTool", () => {
  it("spots a tool call, alone or in a batch", async () => {
    expect(await callsTool(post(toolCall))).toBe(true)
    expect(await callsTool(post([{ jsonrpc: "2.0", id: 2, method: "tools/list" }, toolCall]))).toBe(true)
    expect(await callsTool(post({ jsonrpc: "2.0", id: 3, method: "tools/list" }))).toBe(false)
    expect(await callsTool(new Request("http://localhost/api/mcp"))).toBe(false)
    expect(await callsTool(new Request("http://localhost/api/mcp", { method: "POST", body: "not json" }))).toBe(false)
  })

  it("leaves the body for the SDK to read", async () => {
    const request = post(toolCall)
    await callsTool(request)
    expect(await request.json()).toEqual(toolCall)
  })
})

describe("finishReply", () => {
  // The SDK answers a tool call with a stream right away and runs the tool
  // while it streams; Next applies a route's revalidateTag calls only up to
  // the moment the route returns.
  function server() {
    let finished = false
    const handler = createMcpHandler(
      () => {
        const s = new McpServer({ name: "test", version: "1.0.0" }, { capabilities: { tools: {} } })
        s.registerTool("save", { description: "Saves", inputSchema: z.object({}) }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 30))
          finished = true
          return { content: [{ type: "text", text: "saved" }] }
        })
        return s
      },
      { legacy: "stateless" },
    )
    return { handler, finished: () => finished }
  }

  it("shows why: the SDK's reply comes back before the tool has run", async () => {
    const { handler, finished } = server()
    const response = await handler.fetch(post(toolCall))
    expect(finished()).toBe(false)
    await response.text()
  })

  it("returns a tool call's reply only once the tool has finished, complete", async () => {
    const { handler, finished } = server()
    const reply = await finishReply(await handler.fetch(post(toolCall)), true)
    expect(finished()).toBe(true)
    expect(reply.headers.get("cache-control")).toBe("no-store")
    expect(reply.headers.get("x-robots-tag")).toBe("noindex")
    expect(await reply.text()).toContain("saved")
  })

  it("passes other replies through as a stream", async () => {
    const reply = await finishReply(new Response("data: x\n\n", { headers: { "content-type": "text/event-stream" } }), false)
    expect(reply.headers.get("cache-control")).toBe("no-store")
    expect(await reply.text()).toBe("data: x\n\n")
  })
})
