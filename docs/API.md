# API tokens, MCP and the Shortcuts API

Personal API tokens let programs act as you: Claude over MCP (`/api/mcp`) and
iPhone Shortcuts (`/api/v1/*`, step by step in [SHORTCUTS.md](SHORTCUTS.md)).

## Tokens

Settings → **API tokens** → **Create token**: a name (one token per app, so you
can revoke one without the others), the access, and an expiry (30 days, 90 days,
1 year or never).

| Access | Can | Never |
|---|---|---|
| Read only (default) | every read action of your modules: lists, search, today, budget overview… | change anything |
| Read and write | also capture, add expenses, create and change tasks, notes, links… | sign-in settings, API tokens, the server (ops) |

The token (`aos_` + 48 characters) is shown **once**. The list shows its first
12 characters, when it was last used and when it expires. **Revoke** stops it
immediately. Creating a token needs a recent sign-in (the last hour), like
adding a passkey; Settings offers "Confirm it's you" otherwise.

### Security model

- **Stored hashed.** Only SHA-256 of the token is kept; the first 12 characters
  (`prefix`) find the row. The app's database role can't even read the hash
  column back.
- **Acts as you, through RLS.** A Bearer request is looked up by
  `app.authenticate_api_token()` (unknown, revoked and expired tokens all get
  the same 401), then runs inside `actAs(owner)`: the same module actions and
  row-level security as the web UI. Nothing bypasses RLS.
- **Postgres knows a token is acting.** Every transaction of a token request
  sets `app.api_token_id`; the token table's policies refuse all access then,
  so a token can never list, mint or revoke tokens. A read-only token's
  transactions are `read only`, so Postgres itself refuses any write, even from
  a bug in an action marked "read".
- **Only two places accept tokens:** `/api/mcp` and `/api/v1/*`. Better Auth
  (`/api/auth/*`) and server actions never read the `Authorization` header, so
  sign-in settings and token management are out of reach.
- **Never offered as tools:** the ops control panel and bots registry
  (containers, deploys, logs), the private calendar feed address, browser-only
  upload steps and the expense bot's import (`src/core/mcp/tools.ts`).
- **Rate limits** (Postgres `auth.rate_limit`, survive restarts): 240 requests
  a minute per address, 120 a minute per token; `429` with `Retry-After`.
- **Browsers from other sites are refused** (an `Origin` header that isn't the
  site → 403). Claude, Shortcuts and curl send none.

Code: `src/core/api-tokens/` (tokens, Bearer wrapper), `src/core/mcp/` (server,
tool generation), `src/core/api-v1/` (Shortcuts API). SQL:
`db/modules/core-api-tokens.sql`. Tests: `src/core/**/**.test.ts`,
`db/tests/api-tokens.test.ts`, `e2e/api-tokens.spec.ts`.

## MCP server: `https://anwar-os.com/api/mcp`

Streamable HTTP, stateless: protocol 2026-07-28, with the 2025-era protocol for
older clients. Tools are generated from the modules' typed actions and named
`<module>_<action>` (`tasks_quickAdd`, `notes_list`, `budget_overview`, …), with
each action's own description and input schema. A read-only token sees only
read tools.

### Claude Code

Create a token in Settings (read and write, if Claude should add things), then:

```sh
claude mcp add --transport http anwar-os https://anwar-os.com/api/mcp \
  --header "Authorization: Bearer aos_…"
```

Add `--scope user` to have it in every project. Check with `claude mcp list`
or `/mcp` inside Claude Code. The Settings dialog shows this command with your
token filled in, ready to copy.

### Claude Desktop

Claude Desktop's own "Add custom connector" expects OAuth, which anwar.os
doesn't offer. Use the `mcp-remote` bridge in the config file instead (Claude
Desktop → Settings → Developer → Edit Config, `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "anwar-os": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://anwar-os.com/api/mcp", "--header", "Authorization:${ANWAR_OS_AUTH}"],
      "env": { "ANWAR_OS_AUTH": "Bearer aos_…" }
    }
  }
}
```

(The value goes through `env` because some clients split arguments on spaces.)
Restart Claude Desktop; the tools appear under the tools icon. It needs Node.js.

### Other clients and curl

Any MCP client that can send a header works: URL `https://anwar-os.com/api/mcp`,
header `Authorization: Bearer aos_…`. A quick check:

```sh
curl -s https://anwar-os.com/api/mcp \
  -H "Authorization: Bearer aos_…" -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

### Infrastructure

The edge Caddy proxies everything except `/api/internal/*` to the app, so
`/api/mcp` and `/api/v1/*` (and the `Authorization` header) pass through as
they are; no Caddy change is needed. Responses are `Cache-Control: no-store`.

## Shortcuts API: `/api/v1/*`

| Endpoint | Scope | Body | Answer |
|---|---|---|---|
| `GET /api/v1/today` | read | – | today's events, tasks due and new feedback, as sentences for Siri |
| `POST /api/v1/capture` | write | `text`, optional `kind` (`inbox` default, `task`, `note`, `link`, `idea`), optional `url` | "Saved to Inbox." |
| `POST /api/v1/expense` | write | `text`: one line as in the expense bot, e.g. `250 coffee`, `89,90 food lunch yesterday` | "Saved CZK 250 for coffee (Eating out). Spent today: CZK 540." |

Bodies can be JSON (`{"text": "250 coffee"}`), a form, or plain text (the
whole body is `text`). Answers are plain text; add `?format=json` or
`Accept: application/json` for JSON with the details. Errors are short
sentences too, with the usual status codes (400 bad input, 401 bad token, 403
read-only token, 429 too many requests). An expense with no matching category
is saved without one; set it later in Budget.

Phone setup, step by step: [SHORTCUTS.md](SHORTCUTS.md).
