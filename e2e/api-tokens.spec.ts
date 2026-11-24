// Personal API tokens: create one in Settings (shown once), use it for the
// Shortcuts API and the MCP server, revoke it, and it stops working.
import { randomBytes } from "node:crypto"
import { expect, test, type APIRequestContext } from "@playwright/test"
import { OWNER } from "./support"

test.use({ storageState: OWNER })

const MCP_HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" }

/** One JSON-RPC exchange with /api/mcp (2025 stateless style: JSON or a one-message SSE stream). */
async function mcp(request: APIRequestContext, token: string, id: number, method: string, params: object = {}) {
  const response = await request.post("/api/mcp", {
    headers: { ...MCP_HEADERS, authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" },
    data: { jsonrpc: "2.0", id, method, params },
  })
  const body = await response.text()
  const json = body.trimStart().startsWith("{") ? body : (body.match(/^data: (.*)$/m)?.[1] ?? "{}")
  return { status: response.status(), message: JSON.parse(json) as { result?: Record<string, unknown>; error?: unknown } }
}

test("create a token, use it for Shortcuts and MCP, then revoke it", async ({ page, request }) => {
  const name = `E2E token ${randomBytes(3).toString("hex")}`
  await page.goto("/app/settings")
  const section = page.getByRole("region", { name: "API tokens" })
  await section.getByRole("button", { name: "Create token" }).click()

  const create = page.getByRole("dialog", { name: "New API token" })
  await create.getByLabel("Name").fill(name)
  await create.getByRole("radio", { name: "Read and write" }).click()
  await create.getByRole("button", { name: "Create token" }).click()

  // Shown once, with what to paste into Claude and Shortcuts.
  const reveal = page.getByRole("dialog", { name: "Copy your token now" })
  const token = await reveal.getByRole("textbox", { name }).inputValue()
  expect(token).toMatch(/^aos_[A-Za-z0-9]{48}$/)
  await expect(reveal.getByRole("textbox", { name: "Claude Code: run in a terminal" })).toHaveValue(
    new RegExp(`claude mcp add --transport http anwar-os .*/api/mcp --header "Authorization: Bearer ${token}"`),
  )
  await reveal.getByRole("tab", { name: "iPhone Shortcuts" }).click()
  await expect(reveal.getByRole("textbox", { name: "My day (GET)" })).toHaveValue(/\/api\/v1\/today$/)
  await reveal.getByRole("button", { name: "Done" }).click()
  await expect(reveal).toBeHidden()

  const row = section.getByRole("listitem").filter({ hasText: name })
  await expect(row).toContainText("Read and write")
  await expect(row).toContainText(token.slice(0, 12))
  await expect(page.getByText(token.slice(12))).toHaveCount(0)

  // Shortcuts API: plain text for Siri. The session cookie alone is not enough.
  const today = await request.get("/api/v1/today", { headers: { authorization: `Bearer ${token}` } })
  expect(today.status()).toBe(200)
  expect(await today.text()).toMatch(/^\w+day \d+ \w+\.\n/)
  expect((await request.get("/api/v1/today")).status()).toBe(401)

  // MCP: initialize and tools/list (a write token sees write tools, never ops).
  const init = await mcp(request, token, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "e2e", version: "1.0.0" },
  })
  expect(init.status).toBe(200)
  expect(init.message.result).toMatchObject({ serverInfo: { name: "anwar-os" } })
  const list = await mcp(request, token, 2, "tools/list")
  const names = ((list.message.result?.tools ?? []) as { name: string }[]).map((t) => t.name)
  expect(names).toEqual(expect.arrayContaining(["notes_list", "notes_create", "tasks_quickAdd"]))
  expect(names.some((n) => n.startsWith("ops_"))).toBe(false)

  // Revoke: confirm, gone from the list, and the token stops working at once.
  await row.getByRole("button", { name: "Revoke" }).click()
  const confirm = page.getByRole("alertdialog")
  await confirm.getByRole("button", { name: "Revoke" }).click()
  await expect(page.getByText(`“${name}” is revoked.`)).toBeVisible()
  await expect(confirm).toBeHidden()
  await expect(section.getByText(name)).toHaveCount(0)
  expect((await request.get("/api/v1/today", { headers: { authorization: `Bearer ${token}` } })).status()).toBe(401)
  expect((await mcp(request, token, 3, "tools/list")).status).toBe(401)
})
