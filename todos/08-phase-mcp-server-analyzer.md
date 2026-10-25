# Phase 08 — MCP Server Analyzer & Inspector (Future Phase)

## Objective
Add first-class **Model Context Protocol (MCP) Server Analyzer & Inspector** support to AwapiLasso. Because remote MCP servers communicate over HTTP/HTTPS using **Streamable HTTP** (`POST`/`GET` JSON-RPC 2.0 + Server-Sent Events) and legacy **HTTP+SSE** transports — and frequently require the exact same **OAuth 2.0 / Bearer / API Key / Custom Headers / `{{variable}}` environments** that AwapiLasso already provides — AwapiLasso is uniquely suited to inspect, test, and debug MCP servers alongside REST and GraphQL APIs. Optional local `stdio` transport support can also be executed safely through the Electron Main process.

---

## Tasks Checklist

- [ ] **T8.1 — `.awjc` Schema Support for `protocol: mcp` Requests (`src/shared/models.ts`)**
  - Extend collection request item types to support `protocol: 'mcp'` alongside `'http'` and `'graphql'`.
  - Store MCP transport configuration (`streamable-http`, `sse`, or optional local `stdio`), target endpoint URL (`{{mcp_base_url}}/mcp`), protocol version, capabilities, and selected MCP operation (`initialize`, `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`, `ping`).
  - Inherit Collection/Folder **Auth** (including OAuth 2.0 tokens, Bearer, API Key), **Headers**, **`{{variables}}`**, and **TLS/Proxy** settings automatically.

- [ ] **T8.2 — Main-Process MCP Client & Transport Engine (`src/main/mcpEngine.ts`)**
  - Implement JSON-RPC 2.0 over HTTP/HTTPS in the Electron Main process:
    - **Streamable HTTP Transport (MCP 2025-03-26+ spec):** Single HTTP endpoint supporting `POST` JSON-RPC requests, `Mcp-Session-Id` header tracking, and both `application/json` and `text/event-stream` (SSE) responses.
    - **Legacy HTTP+SSE Transport:** Connect to SSE endpoint, receive `endpoint` event for message `POST` URL, and correlate JSON-RPC request/response IDs over the stream.
    - **Optional Local `stdio` Transport:** Spawn local MCP server command (`npx`, `uvx`, `node`, `python`, binary) in Main process with environment variable interpolation (`{{secret}}` from OS Keychain) and inspect `stdin`/`stdout`/`stderr` JSON-RPC frames.
  - Expose IPC channels (`mcp:connect`, `mcp:disconnect`, `mcp:discover`, `mcp:callTool`, `mcp:readResource`, `mcp:getPrompt`) via `src/preload/index.ts`.

- [ ] **T8.3 — MCP Server Analyzer & Capability Discovery**
  - Perform automated MCP handshake (`initialize` → `notifications/initialized`) and discover:
    - Server info (`name`, `version`, `protocolVersion`, `instructions`) and declared capabilities (`tools`, `resources`, `prompts`, `logging`, `completions`).
    - Full catalog of **Tools** (with JSON Schema `inputSchema`, descriptions, annotations), **Resources / Resource Templates** (URIs, MIME types), and **Prompts** (arguments).
  - Run an **MCP Server Health & Spec Compliance Analyzer**:
    - Validate JSON-RPC 2.0 compliance, `Mcp-Session-Id` handling, OAuth 2.0 / `401 WWW-Authenticate` discovery (MCP Authorization spec), CORS/headers, tool `inputSchema` validity, and token/context footprint estimation (how many tokens the server's tool definitions consume in an LLM context window).

- [ ] **T8.4 — Interactive MCP Workspace UI (`src/renderer/src/components/McpWorkspace.tsx`)**
  - **Discovery & Analyzer Summary Panel:** Server metadata badge, connection/session state, capability matrix, total tool/resource/prompt counts, estimated LLM token cost per tool & total server, and schema/compliance warnings.
  - **Visual Tool Runner (like GraphQL Query Designer):**
    - Browse discovered tools on the left, auto-generate an interactive form from each tool's JSON Schema (`inputSchema`) OR edit the raw JSON arguments in Monaco Editor (with two-way sync and `{{variable}}` interpolation).
    - Execute `tools/call` and inspect structured tool results (`text`, `image`, `resource`, `isError`), execution timing, and raw JSON-RPC wire messages (`Request` / `Response` / `SSE Events`).
  - **Resources & Prompts Browser:** Preview `resources/read` payloads and test `prompts/get` templates with arguments.
  - **Captures & Assertions Integration:** Allow capturing values from MCP tool responses into AwapiLasso variables (`$.result.content[0].text`) and asserting on MCP responses in the Collection Runner.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```
