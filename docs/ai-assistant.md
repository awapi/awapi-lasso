# AI Assistant

AwapiLasso includes an optional, built-in AI chat panel docked to the right of the workspace. You bring your own API key (or a local model), and the assistant can explain errors, write GraphQL queries, and read or edit your requests, responses, environments, and collections. **It cannot see your authentication or secrets.**

Toggle it with the ✨ toolbar button or **Cmd/Ctrl+Shift+A**. Nothing is sent anywhere until you add a key (or point it at a local server) and send a message.

- [Setup](#setup)
- [What you can ask](#what-you-can-ask)
- [What the assistant can do](#what-the-assistant-can-do)
- [Security & privacy](#security--privacy)
- [Troubleshooting](#troubleshooting)
- [Current limits](#current-limits)

## Setup

1. Open the panel and click **Set up AI** (or the gear icon).
2. Pick a provider:
   - **OpenAI**
   - **Anthropic (Claude)**
   - **OpenAI-compatible**: any server that speaks the OpenAI Chat Completions API (LM Studio, Ollama, OpenRouter, Azure OpenAI, Groq, …). Set the base URL; the API key is optional for local servers.
3. Enter the model name and your API key, then click **Test connection** and **Save**.

Example for a local **LM Studio** server (Developer tab → Start Server):

| Field | Value |
|---|---|
| Provider | OpenAI-compatible |
| Base URL | `http://localhost:1234/v1` |
| Model | a model id from `http://localhost:1234/v1/models` that supports tool calling (for example a Qwen 3.x model) |
| API key | leave empty |
| Max output tokens | `4096` or more (thinking models spend tokens on reasoning) |

Ollama's default base URL is `http://localhost:11434/v1`.

Defaults: Anthropic uses `claude-opus-5-5`, and *Max output tokens* is `8192`. Claude 4.7+ and Claude 5-family models reject sampling parameters, so the *Temperature* setting is not sent to them. Their reasoning ("thinking") is kept within a turn so tool calls continue correctly; it is never shown in the chat or sent to the renderer. If Claude declines a request, the chat says so.

## What you can ask

- **Explain an error:** "Why did the last response fail?"
- **Change a request:** "Add an Accept header and switch to POST", "Move the base URL into a variable."
- **GraphQL help:** describe the data you want, or paste sample output, and get a query that is validated against the loaded schema.
- **Work with the workspace:** "Create a request for the users endpoint in the Payments collection", "Add a `region` variable to dev."
- **Test it:** "Send it and tell me what's wrong." (asks before sending)

Code blocks in answers have a **Copy** button.

## What the assistant can do

The assistant works only through a fixed set of tools. Each tool call appears as a chip under the reply.

| Tool | What it does | Approval |
|---|---|---|
| `get_workspace_overview`, `list_collection_items`, `open_request` | Collections, folders, requests, open tabs; open a request in a tab | none |
| `get_request` | Method, URL, params, headers, body, GraphQL query/variables, captures, assertions, auth **type** only | none |
| `get_response` | Status, timing, headers, body (paged), capture and assertion results | none |
| `list_environments` | Environments and collection variables (secret values never shown) | none |
| `get_graphql_schema`, `validate_graphql_query` | Read the GraphQL schema loaded for the active request; validate a query against it | none |
| `update_request` | Edit any request field **except auth** | asks first |
| `create_request` | Add a request to a collection or folder | asks first |
| `set_environment_variables` | Add or change **non-secret** variables | asks first |
| `send_request` | Send the active request (a real network call) | asks first |

Edits and sends show a summary with **Apply / Decline** buttons. Applied edits are **unsaved changes** in the tab and collection; review them and save or discard as usual. GraphQL tools need a schema loaded in the request's GraphQL tab (introspection or a schema file).

## Security & privacy

### At a glance

| Item | Where it lives | Visible to the AI? |
|---|---|---|
| AI provider API key | OS Keychain (encrypted) | **Never.** Write-only from the UI; stays in the main process |
| Auth: bearer, basic/digest, API key, OAuth 2.0 settings and tokens, AWS keys, auth profiles, collection/folder auth | Collection (secrets in Keychain or the gitignored sidecar) | **Never.** The AI sees only the auth *type* (e.g. `bearer`) |
| Variables marked `secret`, and variables with credential-like names | Keychain / sidecar | **Never.** Shown as hidden; the AI cannot read or set them |
| Variables, headers, query params and form fields marked *Hide from AI* (`hideFromAi: true`) | Collection file (value is still saved) | **Never.** Shown as hidden, scrubbed from text, and cannot be overwritten by the AI |
| Credential-like headers and query params (`Authorization`, `Cookie`, `X-Api-Key`, `?api_key=`, …) | Request | **Hidden** (`[REDACTED]`) unless the value is a `{{variable}}` |
| Sent request headers, cookie values | Response data | **Never** |
| Environment variable **names** | Collection | Yes |
| Non-secret environment variable **values** | Collection | Yes by default; turn off with *Share non-secret environment values* |
| Request URL, method, non-credential headers, body | Request | Yes (free text scrubbed, see limits) |
| Response status, headers, body | Last response | Yes (scrubbed, truncated or paged) |
| Request, folder, and collection **names**, request URLs | Collection | Yes (file paths are not sent; attached file paths in form bodies are) |
| Everything you type in the chat | — | Yes. **Do not paste secrets into the chat** |

### API keys

- Stored with the OS Keychain through Electron `safeStorage` (macOS Keychain, Windows DPAPI, Linux Secret Service), in the same encrypted vault as your collection secrets.
- **Write-only from the UI.** The interface can save, replace, remove, and check whether a key exists. No channel returns a key to the renderer.
- Never written to `.awjc` files, Git, or the plain settings file. `ai-settings.json` contains only provider, model, base URL, temperature, token limit, and your preferences.
- If secure storage is unavailable (for example no Secret Service on Linux), AwapiLasso **refuses to save the key** rather than storing it unencrypted.
- Provider calls run in the Electron main process and go **directly from your machine to the provider you chose**. There is no AwapiLasso server in between and no telemetry.
- On macOS, the first save may show the "AwapiLasso Safe Storage" keychain prompt described in the README; it does not expose any other keychain items.

### Authentication and secrets are never visible

This is enforced by design, not just by filtering:

- There is **no tool that reads or writes auth**. `update_request` rejects an `auth` field, and `get_request` returns only the auth type.
- Secret and credential-like variables show as hidden. The assistant cannot set their values; it may add an empty secret variable for you to fill in. Credential-like names include `token`, `secret`, `password`, `pwd`, `api_key`, `auth`, `jwt`, `bearer`, `cookie`, `session`, `signature`, `private_key`.
- For credential-like headers, params, and variables the assistant can only write `{{variable}}` references, never literal values.
- Edits are **upserts**: entries the assistant does not mention are left untouched, so hidden values are never overwritten. Any edit containing the `[REDACTED]` placeholder is rejected.
- Edits containing a literal key in a well-known format (OpenAI/Anthropic `sk-…`, GitHub `ghp_…`, AWS `AKIA…`, Slack, Google, Stripe, GitLab), a PEM private key, or a JWT are rejected anywhere: URL, headers, params, bodies, GraphQL, and variables.
- Requests are shown in their `{{variable}}` template form; resolved values are not substituted.

### How scrubbing works

Layers, applied in this order:

1. **Allow-listed views.** The assistant only receives purpose-built views of requests, responses, and variables (`aiSanitize.ts`), never raw app objects. Auth, sent headers, and cookie values are simply not part of them.
2. **Known-secret removal in the app.** Every secret the app knows (secret variables, literal auth credentials, credential-like headers and params across all open collections, captured secret variables) is replaced with `[REDACTED]` wherever it appears in text.
3. **Pattern scrubbing.** Bearer and Basic credentials, JWTs, PEM private keys, well-known API key formats (`sk-…`, `ghp_…`, `github_pat_…`, `glpat-…`, `AKIA…`, `xoxb-…`, `AIza…`, `sk_live_…`), long random-looking tokens (32+ characters mixing upper case, lower case and digits with high entropy), secret-looking JSON fields (`"access_token": "…"`, `"password": "…"`), credential-like query params, and credentials embedded in URLs (`https://user:pass@host`) are removed.
4. **Second pass in the main process.** The prompt, every tool result, and every error message are scrubbed again before they reach the model. This pass also covers secrets only the main process knows: your AI API key, every value in the OS Keychain vault, and cached OAuth 2.0 access, refresh and ID tokens.
5. **Size limits.** Long JSON arrays are collapsed, large bodies are truncated or paged, and tree and schema results are capped.

### Controls you have

- **Approvals:** edits and sends ask first by default (Apply / Decline). A declined action is reported to the model so it does not retry unchanged.
- **Host changes always ask.** An edit that points a request at a different scheme or host, or changes a URL-valued variable such as `baseUrl`, shows a warning and needs your approval even when *Apply assistant edits without asking* is on.
- **Hide from AI:** the robot-off icon next to the lock in variable, header, param and form tables hides that value from the assistant while still saving it in the file.
- **Unsaved edits:** applied edits are not written to disk until you save, so you can review or discard them.
- **Settings:** *Ask before the assistant sends requests*, *Apply assistant edits without asking*, *Share non-secret environment values*.
- **Stop** cancels a turn at any time, including while a tool waits for your approval.
- **Local models:** use an OpenAI-compatible local server (LM Studio, Ollama) and no data leaves your machine.

### Known limitations

Please read these before using the assistant on sensitive APIs:

- **Free-text scrubbing is best effort.** A credential that appears in a request or response body in an unusual format, under a neutral key, can still be sent to the provider. Short or low-entropy secrets (for example a plain password) are not caught by pattern matching. Conversely, long random identifiers (some base64 ids) may be shown as `[REDACTED]`.
- **Hiding depends on flags and names.** A value in a variable or header with a neutral name that is marked neither `secret` nor *Hide from AI* is visible. Mark credentials as `secret` (this also keeps them out of `.awjc` files) and other private values as *Hide from AI*.
- **Prompt injection.** A malicious API response may contain text that tries to steer the assistant. Response content is marked as untrusted data, and edits and sends need your approval. If you enable *Apply assistant edits without asking* or turn off the send confirmation, you give up most of that safety net (settings shows a warning when both are relaxed); host changes still ask. Keep both on when working with untrusted APIs.
- **Bodies containing literal secrets cannot be edited by the assistant**, because the hidden value cannot be written back. Move such values into `{{variables}}` and edit the body yourself.
- **Your provider's policies apply** to everything sent to it (retention, training). Check them for your provider.

### Recommendations

1. Mark every credential as `secret` and reference it as `{{variable}}`; mark other private values *Hide from AI*.
2. Keep the approval settings on, especially for APIs you do not control.
3. Use a local model for sensitive or regulated APIs.
4. Never type or paste secrets into the chat.
5. Use a provider key with a spending limit, and rotate it if you suspect exposure.

## Troubleshooting

| Problem | What to check |
|---|---|
| "rejected the API key" | Re-enter the key in AI settings; confirm it matches the selected provider |
| "returned 404" | Model name or base URL is wrong. For local servers, list models at `<base URL>/models` |
| Test connection times out | The local server is not running or is still loading the model; retry after it loads |
| "stopped responding (no data for 180 s)" | The provider sent nothing for 3 minutes during a turn, so it was aborted. Check the server, or use a smaller context or model |
| Answers cut off or empty | Raise *Max output tokens* (thinking models need more) and the model's context length (8192 or more) |
| The assistant never uses tools or errors on tools | The model may not support tool calling; pick one that does |
| GraphQL tools say no schema is loaded | Load or discover the schema in the request's GraphQL tab first |
| "Secure storage is unavailable" | The OS keychain or Secret Service is not accessible; the key is not saved by design |

## Current limits

The assistant cannot delete or move requests, edit folder or collection settings, or change auth (by design). Chat history is not saved per tab or across restarts. See [`todos/09-phase-ai-chat-assistant.md`](../todos/09-phase-ai-chat-assistant.md) for the full done / missing list.
