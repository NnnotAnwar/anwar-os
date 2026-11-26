import "server-only"
import { createMcpHandler, McpServer, type AuthInfo, type CallToolResult } from "@modelcontextprotocol/server"
import { publicErrorMessage } from "@/core/api-tokens/errors"
import { ApiError, apiRoute, jsonError, type ApiContext } from "@/core/api-tokens/route"
import { canWrite } from "@/core/api-tokens/token"
import { requireViewer } from "@/core/auth"
import { modulesFor } from "@/core/module"
import { modules } from "@/modules/_registry"
import { callsTool, finishReply } from "./reply"
import { generateTools, resultText, type ToolSource, type ToolSpec } from "./tools"

// The MCP server at /api/mcp (Streamable HTTP, served statelessly: one fresh
// McpServer per request from createMcpHandler, which speaks the 2026-07-28
// revision and falls back to 2025-era stateless serving for older clients).
//
// Auth is a personal API token (src/core/api-tokens/route.ts): the request
// runs as the token's owner, so every tool is the owner's own module action
// under the same RLS as the web UI. Tools: src/core/mcp/tools.ts.

const SERVER_INFO = { name: "anwar-os", title: "anwar.os", version: "1.0.0" }

const INSTRUCTIONS = [
  "anwar.os is Anwar's personal operating system: tasks, inbox, notes, calendar, budget, files, links, ideas, projects, CV and feedback.",
  "Tools are named <module>_<action> (e.g. tasks_quickAdd, notes_list) and act as the account that owns the API token.",
  "Prefer list/search tools to find ids before get/update/delete. Dates are ISO (YYYY-MM-DD); money is in minor units (cents).",
  "Without the token's write scope only read tools are listed.",
].join(" ")

/** The modules the token's owner may use, with their actions loaded. */
async function toolSources(): Promise<ToolSource[]> {
  const viewer = await requireViewer()
  const usable = modulesFor(modules, viewer.role).filter((m) => m.actions)
  return Promise.all(usable.map(async (m) => ({ moduleId: m.id, moduleName: m.name, actions: await m.actions!() })))
}

/** A Standard Schema the SDK can advertise (our JSON Schema) and validate (the action's zod). */
function standardSchema(tool: ToolSpec) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "anwar-os",
      validate(value: unknown) {
        const parsed = tool.parse(value)
        return parsed.success ? { value: parsed.data } : { issues: [{ message: parsed.error }] }
      },
      jsonSchema: { input: () => tool.inputSchema, output: () => tool.inputSchema },
    },
  }
}

/** Expected errors (bad input, read-only token) go back to the model; anything else is logged. */
function toolError(tool: ToolSpec, error: unknown): CallToolResult {
  const message = publicErrorMessage(error)
  if (message === null) console.error(`mcp: ${tool.name} failed`, error)
  return { isError: true, content: [{ type: "text", text: message ?? "That didn't work. Try again, or check the input." }] }
}

export async function buildMcpServer(authInfo: AuthInfo | undefined): Promise<McpServer> {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS, capabilities: { tools: {} } })
  const write = canWrite(authInfo?.scopes ?? [])
  const tools = generateTools(await toolSources(), { write }, (name, error) => console.warn(`mcp: skipped ${name}`, error))
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: standardSchema(tool),
        annotations: {
          title: tool.title,
          readOnlyHint: tool.kind === "read",
          destructiveHint: tool.destructive,
          openWorldHint: false,
        },
      },
      async (input: unknown): Promise<CallToolResult> => {
        try {
          return { content: [{ type: "text", text: resultText(await tool.run(input)) }] }
        } catch (error) {
          return toolError(tool, error)
        }
      },
    )
  }
  return server
}

const handler = createMcpHandler(({ authInfo }) => buildMcpServer(authInfo), {
  legacy: "stateless",
  maxRequestBodySize: 1024 * 1024,
  onerror: (error) => console.warn("mcp:", error.message),
})

async function serve({ request, token }: ApiContext): Promise<Response> {
  const authInfo: AuthInfo = {
    token: token.id,
    clientId: token.id,
    scopes: token.scopes,
    expiresAt: token.expiresAt ? Math.floor(token.expiresAt.getTime() / 1000) : undefined,
  }
  const toolCall = await callsTool(request)
  return finishReply(await handler.fetch(request, { authInfo }), toolCall)
}

/** Errors before MCP takes over (auth, limits) as JSON-RPC-shaped JSON with the HTTP status. */
function mcpError(request: Request, error: ApiError): Response {
  const response = jsonError(request, error)
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: error.message, data: { error: error.code } } }),
    { status: error.status, headers: response.headers },
  )
}

export const mcpRoute = apiRoute({ name: "mcp", scope: "read", renderError: mcpError }, serve)
