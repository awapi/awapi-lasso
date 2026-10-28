# AwapiLasso Features & Roadmap

AwapiLasso is designed around a clear philosophy: **deliver a fast, local-first, cross-platform HTTP, RESTful, and GraphQL client with human-readable `.awjc` YAML collections, zero cloud lock-in, and first-class environment & OAuth 2.0 workflows.**

---

## 🎯 Core Capabilities

### 1. Collections & `.awjc` / `.awj` File Workflow
- **Single-File YAML Collections (`.awjc` & `.awj`):** Each collection is saved locally as a clean, human-readable YAML file (with full JSON compatibility). All folders, requests, environments, and auth profiles belong to the collection file.
- **Double-Click to Open Across OSes:** Native file association for `.awjc` and `.awj` on **macOS** (Finder), **Windows** (Explorer + right-click `"Open with AwapiLasso"` context menu), and **Linux** (desktop MIME registration), plus the `awlasso` CLI command.
- **Multi-Collection Sidebar:** Keep multiple `.awjc` collections open at once, search/filter requests across collections, drag-and-drop folders/requests to reorder them, nest them in folders, or move them to another open collection (changes are kept until you save the affected collections), and duplicate requests easily.
- **External File Change Watcher:** Automatically detects when an open `.awjc` file is modified externally (e.g., after `git pull` or an edit in `AwapiEditor`) and reloads clean collections or prompts when unsaved changes exist.
- **Session Persistence:** Automatically restores open collections, active request tabs, unsaved scratch requests, and selected environments on startup.
- **Import from Postman:** **File → Import → Import from Postman…** (or the toolbar Import menu) converts a Postman Collection v2.0 / v2.1 export. Select environment and globals exports together with the collection to bring them in as environments and collection variables. Folders, requests, headers, query/path params, all body modes (including GraphQL), auth at every level, and variables carry over; literal credentials and `secret` variables are marked `secret: true` so saving moves them to the OS Keychain. Common test-script idioms (`pm.response.to.have.status(...)`, `pm.environment.set("x", pm.response.json().path)`) become assertions and captures; anything that can't be converted (other scripts, unsupported auth types, Faker dynamic variables) is listed in a summary after import. See [Importing Collections](importing.md).
- **Import from Bruno:** **File → Import → Import from Bruno…** (or the toolbar Import menu) reads a Bruno collection folder (select its `bruno.json`; all `.bru` requests, `folder.bru` / `collection.bru` settings, and `environments/*.bru` come along) or a Bruno JSON export. Requests, folders (with headers, auth, and variables), environments, all body modes (including GraphQL), and auth carry over; Bruno `vars:secret` and literal credentials are marked `secret: true` so saving moves them to the OS Keychain. Declarative `assert` rules, `vars:post-response` and common script idioms (`bru.setEnvVar("x", res.body.path)`, `expect(res.status).to.equal(...)`) become assertions and captures; anything else (other scripts, request-level variables, unsupported auth, `{{process.env.*}}`) is listed in a summary after import. See [Importing Collections](importing.md).
- **Unsaved Changes on Quit:** Closing the window or quitting the app while any collection has unsaved changes prompts to **Save All & Quit**, **Don't Save**, or **Cancel**.
- **Environments Manager Save/Cancel:** Edits to environments, collection variables, and auth profiles are made on a draft. **Save** (or Cmd/Ctrl+S) applies them and writes the collection file to disk, and **Cancel** discards them after confirmation.
- **Compact Icon Controls:** Collections/History, New/Open Collection, the top-bar Environments/Runner/Import actions, and refresh controls use icons with hover tooltips and accessible names. Import menu choices keep their text labels.
- **About & Check for Updates:** The Help menu on all platforms (also the application menu on macOS) shows app/runtime versions and project/maintainer links, or manually checks GitHub Releases. Update checks report when you are up to date or a check fails, and offer to open the download page for newer releases; they do not automatically install updates. About, update checks, and Terminal do not add top-toolbar buttons; terminal actions remain available in the View menu.

### 2. HTTP, RESTful & GraphQL Request Builder
- **Full HTTP Method Support:** `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `TRACE`, `CONNECT`, and custom HTTP verbs.
- **Bi-Directional URL & Params Editor:**
  - Live sync between the URL bar and the **Query Params** key-value table (toggle individual params on/off without deleting them).
  - **Path Variables (`:id` / `{id}`):** Automatic detection of path parameters with a dedicated key-value editor.
- **Headers Editor:** Key-value grid with standard HTTP header autocomplete, inherited header preview (from parent Folder/Collection), and bulk raw text editing.
- **Rich Request Bodies:**
  - **JSON / YAML / XML / Plain Text:** Powered by **Monaco Editor** with syntax highlighting, formatting (`Prettify`), folding, and `{{variable}}` autocomplete.
  - **URL-Encoded (`application/x-www-form-urlencoded`):** Key-value grid with enable/disable checkboxes.
  - **Multipart Form (`multipart/form-data`):** Mix text fields and local file uploads in a single table.
  - **Binary File:** Stream any local file directly as the request body.
- **First-Class GraphQL Client, Visual Query Designer & Schema Discovery:**
  - **Schema Discovery & Offline SDL Support:** One-click and automatic GraphQL `IntrospectionQuery` execution using the request's inherited Auth (including OAuth 2.0), Headers, and Environment `{{variables}}`, plus local `.graphql` SDL / `.json` schema import when live introspection is disabled.
  - **Interactive Visual Query Designer:** Point-and-click tree of `Query`, `Mutation`, and `Subscription` root fields, nested sub-fields, inline union/interface fragments (`... on Type`), and typed argument inputs.
  - **Two-Way Live AST Sync:** Checking fields or toggling `$variable` arguments in the **Query Designer** updates the **Monaco GraphQL Query & Variables** editors in real time—and hand-editing the query in Monaco immediately syncs back to the visual Designer tree.
  - **Schema Explorer & Documentation Browser:** Searchable type/field reference with deprecation warnings and one-click **"Generate Starter Query/Mutation"**.
  - **Split Query + Variables Editor:** Monaco editor with schema-aware autocomplete, inline validation squiggles, `Prettify` formatting, and multi-operation selector dropdown.

### 3. Environments, `{{Variables}}` & Secrets Management
- **Multi-Environment Switcher:** Create unlimited environments (`local`, `dev`, `staging`, `prod`, etc.) per collection with color-coded badges in the top bar.
- **Universal `{{variable}}` Interpolation:** Use `{{baseUrl}}`, `{{token}}`, `{{userId}}` in URLs, query/path params, headers, auth settings, request bodies, and GraphQL queries/variables.
- **Built-in Dynamic Variables:** `{{$uuid}}`, `{{$timestamp}}`, `{{$timestampMs}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`, and `{{$randomString}}`.
- **Live Hover Inspection:** Hover over any `{{variable}}` to inspect its resolved value, scope (`Environment`, `Collection`, `Folder`, `Captured`, or `Secret`), and jump straight to its definition.
- **OS Keychain Secret Protection:** Mark sensitive variables (passwords, API keys, client secrets, tokens) as `secret: true`. Values are masked in the UI and stored in the OS Keychain via Electron `safeStorage` (or a gitignored `.secrets.awjc` local sidecar) so plaintext secrets never leak into `.awjc` files.

### 4. Authentication & OAuth 2.0 Token Manager
- **Collection → Folder → Request Inheritance:** Configure auth once at the collection or folder root and let all child requests inherit it (`auth.type: inherit`), or override per request.
- **Standard Auth Schemes:**
  - **Bearer Token** (customizable prefix)
  - **Basic Auth** (`username` / `password` with `{{variable}}` support)
  - **API Key** (injected into Header or Query Parameter)
  - **Digest Auth** & **AWS Signature v4**
- **Built-in OAuth 2.0 Token Acquisition:**
  - **Password Grant (`password`):** Fetch tokens directly using `accessTokenUrl`, `clientId`, `clientSecret`, `username`, `password`, and `scope`.
  - **Client Credentials (`client_credentials`):** Fetch service-to-service tokens using `accessTokenUrl`, `clientId`, `clientSecret`, `scope`, and custom params (e.g., `audience`).
  - **Authorization Code (`authorization_code` + PKCE):** Interactive login flow with automatic callback capture.
  - **Refresh Token (`refresh_token`) & Auto-Refresh:** Automatically refresh expired tokens before sending a request, inspect token expiry countdowns, and decode JWT header/claims in-app.

### 5. Response Inspector, Captures & Assertions
- **Detailed Metrics & Timing Breakdown:** Status code badge, total duration (`ms`) with phase breakdown (DNS, TCP, TLS, TTFB, Download), and payload size.
- **Pretty, Raw & Visual Preview:** Monaco-powered formatted viewer, JSONPath live filter bar (`$.data.items[*]`), HTML sandbox preview, image/SVG rendering, and **Side-by-Side Response Diff View**.
- **Pin & Copy Responses:** **Pin for Diff** toggles a baseline for the current request tab. While pinned, the same button shows **Pinned** with an accent-colored border, including after later requests. Send another request and select **Diff** to compare. Click **Pinned** to unpin and compare against the previous response again; click **Pin for Diff** to pin the current response. **Copy** copies the displayed body (including Pretty formatting or JSONPath filtering; Raw copies the original text), confirms success, and reports clipboard failures.
- **No-Code Response Captures:** Extract values from JSON responses (`$.data.access_token`), headers, or cookies directly into environment/collection variables to chain requests effortlessly.
- **Declarative Assertions:** Verify status codes, response times, headers, and JSONPath expressions with instant pass/fail feedback.

### 6. AI Assistant (Bring Your Own Key)
- **Chat Panel:** Right-docked panel (Cmd/Ctrl+Shift+A) that explains errors, writes GraphQL queries, and reviews requests, using your own OpenAI, Anthropic (Claude), or OpenAI-compatible (Ollama, OpenRouter, …) key.
- **Workspace Tools:** Reads requests, responses, environments, and the collection tree; edits requests, creates requests, updates non-secret variables, and sends requests, with an Apply / Decline approval card (relaxable in settings). Edits stay unsaved until you save.
- **Security by Design:** API keys live in the OS Keychain and are write-only from the UI. Auth and secrets are never visible to the AI; credential-looking headers, params, and variables are hidden and write-protected; responses are scrubbed in the renderer and again in the main process. See [AI Assistant](ai-assistant.md).

---

## 🗺️ Phased Implementation Roadmap

### Phase 1: Core Foundation, `.awjc` Engine & REST Client (MVP)
- [ ] Electron + React 19 + TypeScript + Vite + Vitest scaffold (matching `AwapiEditor` architecture).
- [ ] `.awjc` / `.awj` YAML & JSON parser, validator, serializer, and OS file associations (`open-file`, `second-instance`, Windows context menu).
- [ ] Multi-collection sidebar, folder/request tree, and multi-tab request workspace with session persistence.
- [ ] Node.js Main-process HTTP engine (`src/main/httpEngine.ts`) with full timing breakdown, custom headers, and TLS controls.
- [ ] RESTful request builder (URL bar, Query/Path params sync, Headers, JSON/YAML/XML/Text/Form/Multipart/Binary bodies).
- [ ] Environment manager, `{{variable}}` interpolation engine, dynamic variables, and OS Keychain (`safeStorage`) secret storage.
- [ ] Basic Auth, Bearer Token, and API Key authentication with Collection/Folder inheritance.
- [ ] Response Inspector (Pretty/Raw/Preview, JSONPath filter, Headers, Cookies, TLS info).

### Phase 2: OAuth 2.0 Token Manager, GraphQL Query Designer & Request Chaining
- [ ] Full **OAuth 2.0 Token Manager** (`password`, `client_credentials`, `authorization_code` + PKCE, `refresh_token`), JWT decoder, token cache, and auto-refresh.
- [ ] **GraphQL Schema Discovery, Visual Query Designer & Split Editor:**
  - Live `IntrospectionQuery` discovery (with Auth/OAuth2/Environment variables), local schema cache, and `.graphql` SDL / `.json` file fallback.
  - Interactive **Visual Query Designer** tree (point-and-click field selection, argument editor, automatic `$variable` wiring, and `... on Type` inline fragments) with two-way AST synchronization (`graphql` parser/printer) to the Monaco Query & Variables editors.
  - Searchable **Schema Documentation Explorer** and schema-driven Monaco autocomplete & validation.
- [ ] **Declarative Response Captures** (extract JSONPath/header/cookie values into variables after response) and **Declarative Assertions** (`status`, `responseTime`, `header`, `jsonpath`).
- [ ] **Side-by-Side Response Diff Viewer** (compare two responses or pin a baseline response in Monaco Diff Editor).

### Phase 3: Import/Export, Code Generation & Collection Runner
- [ ] Paste-to-Import `curl` commands and OpenAPI 3.x / Swagger 2.0, Postman v2.x, and Bruno collection importers.
- [ ] Code Snippet Generator (`curl`, JS/TS `fetch`, Python `requests`/`httpx`, Go, C#, Rust).
- [ ] Sequential **Collection / Folder Runner** with pass/fail assertion summary and exportable report.
- [ ] Local Request History log with one-click restore.

### Phase 4: Built-in Git Integration (Enabled by Local `.awjc` YAML Storage)
- [ ] Git repository status indicator per collection folder (current branch, clean/dirty badge).
- [ ] In-app visual YAML diff viewer for modified `.awjc` collections.
- [ ] Commit, branch switch, pull, and push directly from AwapiLasso (with pre-commit secret check verification).
