# Phase 09 — AI Chat Assistant

**Status: 🚧 shipped (chat, keys, providers, workspace tools, GraphQL schema tools, redaction). Hardening, UX polish, and extras remain — see [What's missing](#whats-missing).**

## Objective
An integrated, **bring-your-own-key AI chat assistant**. Users store their own provider API key (OpenAI, Anthropic, or any OpenAI-compatible server such as LM Studio / Ollama / OpenRouter) in the OS Keychain, then chat in a right-docked panel to explain errors, write GraphQL queries, and read or edit requests, responses, environments, and collections.

It is **built into the app** using LLM tool calling that runs against the app's own state. It does **not** use an MCP server (optional later, T9.9).

### Design principles (all implemented)
- **Keys never leave Main.** The renderer can only store, replace, remove, and check for a key. All provider calls run in `src/main/`.
- **Auth and secrets are never visible.** Auth is reduced to its type; secret and credential-looking values are hidden; there is no tool that reads or writes auth or secrets.
- **Propose, don't mutate.** Edits and sends need an in-chat Apply/Decline (settings can relax this). Applied edits are unsaved until the user saves.
- **Provider-agnostic.** OpenAI, Anthropic, and OpenAI-compatible over plain `fetch` (no SDKs).
- **Validated output.** GraphQL is validated against the loaded schema with errors returned to the model.

### Architecture
`Renderer (chat UI + tool executors over app state)` ⇄ `Preload (ai:* channels)` ⇄ `Main (agent loop + provider calls + key storage)`. Main runs the loop; each `tool-call` is forwarded to the renderer, which executes it against React state (`useAiWorkspace`) and replies with `ai:toolResult`. Results are sanitized in the renderer and scrubbed again in Main.

---

## ✅ What's done

| Area | Done | Where |
|---|---|---|
| Key storage | Per-provider keys in OS Keychain via `secretStore`; write-only from UI; refuses to save if encryption unavailable | `src/main/ai/aiSettingsStore.ts` |
| Settings | Provider, model per provider, base URL, temperature, max tokens, ask-before-send, apply-edits-without-asking, share-environment-values | `aiSettingsStore.ts`, `AiSettingsModal.tsx` |
| Providers | OpenAI, Anthropic, OpenAI-compatible; SSE streaming; abort; friendly HTTP errors; tool calling (`tools` / `tool_use`) | `src/main/ai/providers/`, `sseParser.ts` |
| Agent loop | Multi-round tool loop (max 8), cancellation, tool timeout, result scrubbing, unknown-tool / bad-args handling | `src/main/ai/aiService.ts` |
| IPC | `ai:getSettings/saveSettings/getKeyStatuses/setKey/clearKey/testConnection/listModels/send/cancel/toolResult` + `ai:event` stream | `aiIpc.ts`, `src/preload/` |
| Chat UI | Docked, resizable, persisted width; streaming; code blocks + Copy; quick actions; onboarding + privacy notice; Stop/Clear; toolbar button + Cmd/Ctrl+Shift+A; tool-activity chips; Apply/Decline cards | `AiChatPanel.tsx`, `useAiChat.ts`, `useAiApprovals.ts` |
| Read tools | workspace overview, request, response (paged), environments, collection tree, open request, GraphQL schema (overview/type/search), GraphQL validate | `src/shared/aiTools.ts`, `aiToolHost.ts`, `aiGraphql.ts` |
| Write tools | update request, create request, set environment variables, send request (all approval-gated) | `aiToolHost.ts`, `aiSanitize.ts` |
| Security | Sanitizers for requests/responses/variables; credential-name detection; `[REDACTED]` rejected on write; credentials must be `{{variables}}`; upsert semantics keep hidden values; workspace-wide secret collection; URL userinfo redaction; double scrubbing; prompt tells model response content is untrusted | `aiContext.ts`, `aiSanitize.ts`, `aiContextBuilder.ts` |
| Tests | Unit/component tests for all of the above; optional live test against a real server | `*.test.ts(x)`, `src/main/ai/aiLive.test.ts` |
| Live verification | Passed against LM Studio (`qwen/qwen3.6-35b-a3b`): connection test, streaming, tool loop, real header edit with secrets never reaching the model | `aiLive.test.ts` |
| Docs | `docs/ai-assistant.md`, README, `docs/features.md`, `AGENTS.md` security rules, electron-ipc skill | — |

### Task checklist
- [x] **T9.1** AI settings & secure key storage
- [x] **T9.2** Shared AI types (`aiTypes.ts`, incl. tool/message types)
- [x] **T9.3** Provider layer (OpenAI, Anthropic, OpenAI-compatible; tools)
- [x] **T9.4** Context builder & redaction (`aiContext.ts`, `aiSanitize.ts`, `aiContextBuilder.ts`)
- [x] **T9.5** Tool registry & agent loop (workspace read/write + GraphQL schema/validate)
- [x] **T9.6** IPC channels (approval happens in-chat, so no separate `ai:confirmToolCall` / `ai:applyProposal`)
- [x] **T9.7** Chat panel UI (MVP + tools; remaining polish below)
- [x] **T9.8** AI settings UI
- [x] **T9.10** Docs & skill updates
- [ ] **T9.9** (Optional) Expose the tool registry as an MCP server — Streamable HTTP on `127.0.0.1` with a per-session token or `stdio`, off by default, explicit opt-in.

---

## What's missing

### 🔒 Security hardening
- [x] **Per-variable "hide from AI" flag**: `hideFromAi: true` on variables and key-value entries (headers, params, url-encoded fields); value stays in the file but is masked, scrubbed and write-protected; robot-off toggle in `KeyValueTable`; documented in the file-format spec and authoring guide.
- [x] **Scrub main-process secrets**: keychain vault values and cached OAuth 2.0 access/refresh/id tokens are added to the scrub list for the prompt, tool results and errors (`src/main/ai/mainSecrets.ts`).
- [x] **Prompt-injection hardening**: URL scheme/host changes and edits to URL-valued variables (`baseUrl`) always ask with a warning, even with auto-apply on; settings warns when both auto-apply is on and send confirmation is off (`changesUrlOrigin` / `changedUrlVariables` in `aiSanitize.ts`, `aiToolHost.ts`).
- [ ] **"What will be sent" preview**: let the user inspect the exact context/tool output before or after a turn.
- [x] **Stronger free-text detection**: well-known key formats (`sk-…`, `ghp_…`, `github_pat_…`, `glpat-…`, `AKIA…`, Slack, Google, Stripe), PEM private keys, Basic credentials, and high-entropy tokens are scrubbed; writes containing a literal known-format key / private key / JWT are rejected (`aiContext.ts`, `aiSanitize.ts`).
- [ ] **Literal secrets in request bodies cannot be edited by the AI** (edits containing `[REDACTED]` are rejected). Decide whether to support targeted body patches (JSON path edits) so hidden fields survive.
- [ ] Optional **tool-call audit log** (what the assistant read/changed per session).
- [x] Security review pass (`/security-review`) over `src/main/ai/` and the renderer tool host. Fixed three ways around "host changes always ask": `create_request` to a new host (now warns), URL-variable changes judged by value shape only (now `hostVariableNames` + enabled toggles + `https:host` forms), and captures into `baseUrl` (now warn). Added a send-time check: `send_request` shows the resolved host and asks the first time per host in a chat (`resolveRequestOrigin`, `approvedSendOrigins`).
- [ ] Follow-up from the review: the app stores every capture in the highest-precedence captured layer regardless of its `scope` (`App.tsx` `handleSendRequest`); worth fixing outside the AI work.
- [ ] Decide whether the user's own sends should also be checked after an assistant edit. The send-time host check only runs for `send_request`; if the user approves (or auto-applies) a host-variable edit, their next manual Send goes to the new host without another prompt. Option: mark requests/variables touched by the assistant and show the resolved host once on the next manual send.
- [ ] Refresh the threat-model docs: `docs/ai-assistant.md` "Prompt injection" paragraph (still says only "host changes still ask") should mention the first-send-per-host prompt and the capture/variable checks.

### 🧩 Functionality
- [x] **Tool-triggered GraphQL schema load**: `load_graphql_schema` (risk `run`, asks first) runs the GraphQL tab's discovery (introspection, then local file) via a loader published in `aiGraphqlSchema.ts`.
- [ ] Optional: send trimmed SDL in the initial context.
- [ ] More tools: delete / move / rename requests and folders, create folders and collections, folder- and collection-level settings (headers, variables), request history, other tabs' responses, runner results, captured variables. (Auth stays excluded by design.)
- [ ] Feed `docs/ai-authoring-guide.md` into the prompt for whole-collection authoring.
- [x] `ai:listModels` (best effort): **Load models** in AI settings lists `GET {baseUrl}/models` (OpenAI filtered to chat models, Anthropic in API order) as `<datalist>` suggestions; the field stays free text (`listAiModels` in `aiService.ts`, `getListModels` in `providers/`).
- [x] Conversation memory across turns includes tool results: Main emits a `tool-transcript` at the end of a turn (scrubbed results, no provider internals); the renderer sends it back and Main validates, re-scrubs and expands the last 3 turns with results capped at 4,000 chars.
- [x] Fallback to chat-only when a model/server does not support tool calling (round-0 "tools not supported" errors retry without tools, notify the user, and are remembered per provider/base URL/model).

### 🖥️ UX
- [x] Before/after **diff** in edit approval cards (`describeRequestChanges` / `describeVariableChanges`; hidden values stay masked).
- [x] **Undo** for applied edits (last 5 in the panel; restores the previous request/variables or removes a created request).
- [ ] **"Apply to request"** on GraphQL/JSON code blocks.
- [ ] **"Explain this error"** button on the response inspector.
- [x] Markdown rendering for answers (`markdown.ts` + `AiMarkdown.tsx`: headings, lists, quotes, tables, emphasis, inline code; React elements only, links shown but not clickable).
- [ ] Per-tab / persisted chat history across restarts.
- [ ] Token usage and cost display; surface reasoning/"thinking" content for reasoning models.

### ⚙️ Platform & providers
- [x] **Proxy / custom CA support** for AI calls: Main passes Electron `net.fetch` as `fetchImpl`, so provider calls use the OS proxy settings (incl. PAC) and the OS certificate store. TLS verification stays on. (The HTTP engine itself has no proxy support yet.)
- [ ] Azure OpenAI URL / `api-version` handling; Gemini via native API (OpenAI-compatible endpoint works today).
- [x] Idle timeout for hung servers during a turn: a provider stream silent for 3 minutes is aborted with a clear error (`withIdleTimeout` in `aiService.ts`).
- [x] Deliver `ai:event` to the originating window (the `ai:send` sender; main window as fallback).
- [x] Anthropic default is now `claude-opus-5-5` (`claude-sonnet-4-5` retires 2026-11-30); default max output tokens raised to 8192. Anthropic provider omits `temperature` for Claude 4.7+/5-family models, replays thinking blocks unchanged within a turn, and reports refusals.
- [ ] OpenAI default (`gpt-4o-mini`) is still unverified against current OpenAI docs.
- [ ] Optional: Anthropic server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) for Opus 5.5 / Sonnet 5.5; needs handling of `fallback` blocks and partial text in the chat UI.

### 🧪 Testing
- [ ] **Manual check in the running app** of the work from 2026-10-27 (only unit-tested so far):
  - **Load models** with OpenAI, Anthropic and LM Studio/Ollama (list appears; errors are readable).
  - **`net.fetch` streaming**: Test connection, then a chat turn whose answer streams in progressively; Stop cancels mid-stream; a tool loop still works. If streaming arrives in one chunk or abort fails, fall back to Node `fetch` and track proxy support separately.
  - **Behind a proxy / TLS-inspecting network**, if one is available: AI calls succeed with the OS proxy settings and the company root CA.
  - **Host checks**: ask the assistant to send a request — the approval shows `→ https://resolved.host` and a first-send warning (even with send confirmation off); with auto-apply on, `create_request` to a new host, disabling `baseUrl`, and a capture into `baseUrl` all ask.
- [ ] Live smoke tests against real **OpenAI** and **Anthropic** (the live test currently targets OpenAI-compatible servers; add `AI_LIVE_PROVIDER` + key env vars).
- [ ] Electron end-to-end test of the panel (key save → chat → approval → edit).
- [ ] Manual QA checklist for release (keychain prompt on macOS, Linux without Secret Service, light theme).

---

## Risks & open questions
- **Free-text leakage**: redaction of bodies/responses is best effort; a credential echoed in an unusual format can reach the provider. Mitigation: local models, warnings in docs, the hardening items above.
- **Prompt injection** from API responses: mitigated by approvals, the "untrusted data" instruction, and host checks that ask even with auto-apply on (host/scheme edits, new requests to unknown hosts, host-variable and capture changes, and the first assistant send per resolved host in a chat). Remaining gaps: with auto-apply on, other edits (bodies, headers, paths) apply silently, and the user's own manual sends are not re-checked after an assistant edit.
- **Host decisions on unresolvable URLs**: when a request's host can't be resolved in the renderer (e.g. a host built from a `secret` variable only Main hydrates), `send_request` always asks. That is safe but may prompt more than expected.
- **Context size**: large schemas and responses are capped/paged; very large schemas may still need smarter trimming.
- **Model quality**: tool calling reliability varies by model; small local models may mis-call tools.

---

## Handoff — suggested order for the next session
State on 2026-10-27: branch `feature/ai-chat`; `ai:listModels`, `net.fetch` for AI calls, and the security-review fixes are done and pushed, verified with typecheck / tests / build only (**not yet checked in the running app**).

1. Manual check in the running app (Testing → first item); fix anything it finds.
2. Live smoke tests against real OpenAI and Anthropic; settle the OpenAI default model at the same time.
3. Fix capture `scope` handling in `App.tsx` (security follow-up).
4. "Explain this error" button on the response inspector.
5. "Apply to request" on GraphQL/JSON code blocks (must go through approvals and the host checks).
6. "What will be sent" preview.
7. More tools (each needs `isEntryHiddenFromAi`, host checks where they can redirect, and secret-leak tests).

Then the optional items: persisted chat history, token usage, Azure/Gemini, body patches for hidden fields, trimmed SDL, authoring guide in the prompt, Anthropic refusal fallback, E2E test, audit log, MCP server (T9.9).

---

## Verification Gate
```bash
npm run typecheck
npm run test
npm run build
# optional live check against a local OpenAI-compatible server:
AI_LIVE_BASE_URL=http://localhost:1234/v1 AI_LIVE_MODEL=<model-id> npx vitest run src/main/ai/aiLive.test.ts
```
