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
| IPC | `ai:getSettings/saveSettings/getKeyStatuses/setKey/clearKey/testConnection/send/cancel/toolResult` + `ai:event` stream | `aiIpc.ts`, `src/preload/` |
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
- [ ] Security review pass (`/security-review`) over `src/main/ai/` and the renderer tool host.

### 🧩 Functionality
- [ ] **Tool-triggered GraphQL schema load / introspection** (today the user must load the schema in the GraphQL tab first). Send trimmed SDL in the initial context.
- [ ] More tools: delete / move / rename requests and folders, create folders and collections, folder- and collection-level settings (headers, variables), request history, other tabs' responses, runner results, captured variables. (Auth stays excluded by design.)
- [ ] Feed `docs/ai-authoring-guide.md` into the prompt for whole-collection authoring.
- [ ] `ai:listModels` (best effort) to populate the model field.
- [ ] Conversation memory across turns includes tool results (today only the final text is kept, so the assistant re-reads each turn).
- [ ] Fallback to chat-only when a model/server does not support tool calling.

### 🖥️ UX
- [ ] Before/after **diff** in edit approval cards (today shows new values only).
- [ ] **Undo** for applied edits.
- [ ] **"Apply to request"** on GraphQL/JSON code blocks.
- [ ] **"Explain this error"** button on the response inspector.
- [ ] Markdown rendering for answers (headings, lists, tables, inline code).
- [ ] Per-tab / persisted chat history across restarts.
- [ ] Token usage and cost display; surface reasoning/"thinking" content for reasoning models.

### ⚙️ Platform & providers
- [ ] **Proxy / custom CA support** for AI calls (they use plain Node `fetch`, not the HTTP engine's settings).
- [ ] Azure OpenAI URL / `api-version` handling; Gemini via native API (OpenAI-compatible endpoint works today).
- [x] Idle timeout for hung servers during a turn: a provider stream silent for 3 minutes is aborted with a clear error (`withIdleTimeout` in `aiService.ts`).
- [x] Deliver `ai:event` to the originating window (the `ai:send` sender; main window as fallback).
- [x] Anthropic default is now `claude-opus-5-5` (`claude-sonnet-4-5` retires 2026-11-30); default max output tokens raised to 8192. Anthropic provider omits `temperature` for Claude 4.7+/5-family models, replays thinking blocks unchanged within a turn, and reports refusals.
- [ ] OpenAI default (`gpt-4o-mini`) is still unverified against current OpenAI docs.
- [ ] Optional: Anthropic server-side refusal fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) for Opus 5.5 / Sonnet 5.5; needs handling of `fallback` blocks and partial text in the chat UI.

### 🧪 Testing
- [ ] Live smoke tests against real **OpenAI** and **Anthropic** (the live test currently targets OpenAI-compatible servers; add `AI_LIVE_PROVIDER` + key env vars).
- [ ] Electron end-to-end test of the panel (key save → chat → approval → edit).
- [ ] Manual QA checklist for release (keychain prompt on macOS, Linux without Secret Service, light theme).

---

## Risks & open questions
- **Free-text leakage**: redaction of bodies/responses is best effort; a credential echoed in an unusual format can reach the provider. Mitigation: local models, warnings in docs, the hardening items above.
- **Prompt injection** from API responses: mitigated by approvals and the "untrusted data" instruction, weaker when auto-apply is enabled.
- **Context size**: large schemas and responses are capped/paged; very large schemas may still need smarter trimming.
- **Model quality**: tool calling reliability varies by model; small local models may mis-call tools.

---

## Verification Gate
```bash
npm run typecheck
npm run test
npm run build
# optional live check against a local OpenAI-compatible server:
AI_LIVE_BASE_URL=http://localhost:1234/v1 AI_LIVE_MODEL=<model-id> npx vitest run src/main/ai/aiLive.test.ts
```
