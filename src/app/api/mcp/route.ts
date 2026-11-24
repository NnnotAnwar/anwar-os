// MCP server (Streamable HTTP) for Claude and other MCP clients. Bearer auth
// with a personal API token. src/core/mcp/server.ts; setup: docs/API.md.
export { mcpRoute as GET, mcpRoute as POST, mcpRoute as DELETE } from "@/core/mcp/server"
