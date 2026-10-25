# AwapiLasso — Product & Technical Requirements

## 1. Product Vision & Goals

**AwapiLasso** is a fast, lightweight, local-first HTTP, RESTful, and GraphQL API client built for native cross-platform execution on **Windows, macOS, and Linux**.

### Core Design Principles
1. **Local-First & Offline-Ready:** No mandatory cloud account or remote sync server. Every collection is saved directly on the user's local disk as a self-contained, human-readable **YAML** file (`.awjc` — *AwapiLasso Collection*, with `.awj` also supported) or optional JSON.
2. **Git-Native by Design:** Because collections are clean, deterministic YAML files on disk with sensitive secrets kept out of plaintext, users can version-control their `.awjc` files with Git immediately—and seamless built-in Git integration can be layered in later without migrating data.
3. **Click-to-Open OS Integration:** Double-clicking any `.awjc` or `.awj` file in macOS Finder, Windows Explorer, or a Linux file manager (or invoking `awlasso <file.awjc>` from the terminal) opens the collection directly inside AwapiLasso.
4. **Universal Protocol Support:** First-class support for **RESTful APIs**, arbitrary **HTTP/HTTPS** requests, and **GraphQL** (queries, mutations, variables, and schema introspection).
5. **Powerful Environments, Variables & Secrets:** Interpolate `{{variables}}` anywhere (URL, path parameters, query parameters, headers, auth fields, request body, GraphQL query/variables) with strict separation between shareable environment values and protected secrets (passwords, API keys, OAuth 2.0 tokens).
6. **Built-in OAuth 2.0 Token Acquisition:** Fetch, inspect, cache, and auto-refresh OAuth 2.0 tokens directly from token endpoints using **Password (`password`)**, **Client Credentials (`client_credentials`)**, **Authorization Code (`authorization_code` + PKCE)**, and **Refresh Token (`refresh_token`)** flows.

---

## 2. Target Platforms & Architecture

### 2.1 Operating Systems & Installers
| OS | Architectures | Packaging Targets | OS File Integration |
|---|---|---|---|
| **macOS** | `arm64` (Apple Silicon), `x64` (Intel) | `.dmg` + one-line `install-macos.sh` installer | `CFBundleDocumentTypes` for `.awjc` & `.awj`, Finder "Open With", `open-file` event |
| **Windows** | `x64`, `arm64` | `.exe` (NSIS installer), `.msi` | Registry file associations for `.awjc` & `.awj`, Windows Explorer `"Open with AwapiLasso"` context menu |
| **Linux** | `x64`, `arm64` | `.AppImage`, `.deb` | `.desktop` MIME type registration (`application/x-awapi-lasso`), CLI wrapper |

### 2.2 Technical Stack (Aligned with Awapi Ecosystem)
- **Runtime & Shell:** Electron (Main + Preload + Renderer with `contextIsolation: true` and `nodeIntegration: false`)
- **Frontend UI:** React 19 + TypeScript (Strict Mode) + Lucide Icons
- **Code & Payload Editor:** Monaco Editor (`@monaco-editor/react`) for JSON, YAML, GraphQL, XML, HTML, and raw HTTP payload editing/viewing
- **Build & Packaging:** Vite (`vite-plugin-electron`, `vite-plugin-electron-renderer`) + `electron-builder` + `pnpm` + `justfile`
- **Testing:** Vitest + React Testing Library + JSDOM (mandatory co-located unit tests `*.test.ts` / `*.test.tsx`)

### 2.3 Why HTTP Execution Runs in the Electron Main Process
All outbound HTTP, REST, GraphQL, and OAuth 2.0 requests are executed in the **Electron Main process** (`src/main/httpEngine.ts`) rather than the Chromium renderer:
- **Zero CORS Restrictions:** API endpoints without browser CORS headers work identically to CLI tools like `curl`.
- **Full Header Control:** Send restricted headers (`User-Agent`, `Host`, `Cookie`, `Origin`, `Referer`, custom `Authorization`) without browser stripping.
- **Low-Level Timing & TLS Inspection:** Capture DNS lookup, TCP connection, TLS handshake, Time-to-First-Byte (TTFB), content download duration, and peer TLS certificate metadata.
- **Custom Certificates & Proxies:** Support self-signed certificate toggles (`rejectUnauthorized`), custom CA bundles, mTLS client certificates (`.pem` / `.pfx`), and HTTP/HTTPS/SOCKS proxies.

---

## 3. Functional Requirements

### FR-1: Collections & Workspace Management (`.awjc` / `.awj`)
- **FR-1.1 Single-File Collection Format:** Each collection is stored in a single `.awjc` (or `.awj`) file on disk. All requests, nested folders, collection-level headers/auth, and environments belong to that collection file—no scattered per-request files required.
- **FR-1.2 YAML Default with JSON Compatibility:**
  - By default, `.awjc` and `.awj` files are serialized as clean, human-readable **YAML** (2-space indentation, stable key ordering for clean diffs).
  - AwapiLasso also auto-detects and loads JSON-formatted `.awjc`/`.awj` files and allows exporting/saving in either YAML or JSON.
- **FR-1.3 Collection Hierarchy:**
  - A collection contains metadata (`name`, `description`, `version`, `schemaVersion`), default settings (`baseUrl`, default headers, default auth), `environments`, `variables`, and an ordered tree of `items` (folders and requests).
  - Folders can be nested arbitrarily deep and can define folder-level `auth` and `headers` that cascade down to child requests.
- **FR-1.4 Multi-Collection Sidebar:**
  - Users can keep multiple `.awjc` collections open in the left sidebar workspace simultaneously.
  - Create New Collection (`Cmd/Ctrl+Shift+N`), Open Collection File (`Cmd/Ctrl+O`), Save (`Cmd/Ctrl+S`), Save As (`Cmd/Ctrl+Shift+S`), and Open Recent Collections.
- **FR-1.5 External Change Detection & Crash-Safe Session:**
  - Watch open `.awjc` files on disk (e.g., when updated via `git pull` or an external editor). Automatically reload clean collections or prompt when unsaved edits exist.
  - Persist open tabs, unsaved draft requests, and active environment selection across restarts.

### FR-2: OS File Association, Double-Click Open & CLI
- **FR-2.1 Native File Associations:** Register `.awjc` (AwapiLasso Collection) and `.awj` with the OS via `electron-builder` `fileAssociations`:
  - Double-clicking `my-service.awjc` in Finder / Windows Explorer / Linux file manager launches AwapiLasso (or focuses the existing window via `app.requestSingleInstanceLock()`) and opens that collection in the sidebar and active workspace.
- **FR-2.2 Windows Explorer Context Menu:** Provide an optional `"Open with AwapiLasso"` right-click context menu registration on Windows (toggleable in **Preferences**, matching `AwapiEditor`).
- **FR-2.3 CLI Launcher (`awlasso`):** Installable shell command (`awlasso path/to/api.awjc`) to open collection files from any terminal.

### FR-3: HTTP & RESTful Request Builder
- **FR-3.1 HTTP Methods:** Support `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `TRACE`, `CONNECT`, plus user-defined custom HTTP verbs (e.g., `PROPFIND`, `PURGE`, `LOCK`).
- **FR-3.2 URL & Parameter Sync:**
  - Live bi-directional synchronization between the URL bar and the **Query Params** key-value table (with per-row enable/disable checkboxes and descriptions).
  - **Path Parameters:** Support `:paramName` or `{paramName}` placeholders in the URL path with a dedicated **Path Variables** editor table.
  - Full `{{variable}}` interpolation inside the URL (e.g., `{{baseUrl}}/v1/users/{{userId}}?locale={{locale}}`).
- **FR-3.3 Headers Editor:**
  - Key-value table with enable/disable checkboxes, description column, auto-complete for standard HTTP headers (`Accept`, `Authorization`, `Content-Type`, `Cache-Control`, `X-Request-ID`, etc.), and bulk raw key-value edit mode.
  - View inherited headers from the parent Folder/Collection alongside request-specific headers.
- **FR-3.4 Request Body Modes:**
  - `none` — No body.
  - `json` — Monaco editor with JSON syntax highlighting, validation, formatting (`Prettify`), and `{{variable}}` support.
  - `yaml` — Monaco editor with YAML syntax highlighting.
  - `xml` / `html` / `text` — Monaco editor with corresponding language mode.
  - `form-urlencoded` (`application/x-www-form-urlencoded`) — Key-value table with enable/disable toggles and variable interpolation.
  - `multipart-form` (`multipart/form-data`) — Key-value table supporting both **Text** fields and **File** attachments (single or multiple local files per key).
  - `binary` (`application/octet-stream` or custom `Content-Type`) — Select a local file to stream as the raw request payload.

### FR-4: GraphQL Support (Schema Discovery, Visual Query Designer & Split Editor)
- **FR-4.1 GraphQL Request Mode:** Any request can be set to `protocol: graphql` (supports `POST` JSON payload `{ query, variables, operationName }` as well as `GET` query-parameter encoding).
- **FR-4.2 Schema Discovery, Introspection & Offline SDL Import:**
  - **One-Click & Auto Schema Discovery:** Sends the standard GraphQL `IntrospectionQuery` to the resolved request URL through the Main-process HTTP engine, automatically applying the request's inherited/configured **Auth** (including OAuth 2.0 tokens), **Headers**, **TLS/Proxy settings**, and **Active Environment `{{variables}}`**.
  - **Auto-Fetch & Background Refresh:** Optional per-request or per-collection setting to automatically discover the schema when opening a GraphQL request or switching environments (`local` ↔ `staging` ↔ `prod`), plus a manual **Refresh Schema** button with "Last fetched" timestamp indicator.
  - **Fallback SDL / JSON Schema Import:** For production GraphQL servers where live introspection is disabled, users can load a local `.graphql` / `.gql` SDL file or an introspection `.json` file and bind it to the request or collection.
  - **Local Schema Cache & Diff:** Introspected schemas are cached locally per `(collectionId, environmentName, endpointUrl)` so the **Query Designer**, **Schema Explorer**, and **Autocomplete** work immediately offline, and users can view a diff when a remote schema changes.
- **FR-4.3 Interactive Visual GraphQL Query Designer (Point-and-Click Builder):**
  - **Tree-Based Operation Builder:** An interactive visual tree alongside the Monaco editor displaying root operation types (`Query`, `Mutation`, `Subscription`).
  - **Checkbox Field & Nested Sub-Field Selection:**
    - Checking any field or nested object field in the Designer automatically adds it to the GraphQL query AST in the Monaco editor.
    - Selecting an object/connection field whose sub-selection is empty automatically selects its default scalar fields (`id`, `name`, `title`, or first scalar fields) or expands its child list so the generated query is always syntactically valid.
  - **Interactive Argument & Input Builder:**
    - Expand any field in the Query Designer to see its typed arguments (with required `*` badges, default values, and enum dropdowns).
    - **Variable Parameterization (`$var` Toggle):** One click on any argument in the Designer promotes it to a typed GraphQL operation variable (e.g., `query GetWarehouseStock($sku: ID!, $warehouseId: ID)`), inserts `$sku` into the field argument, and automatically populates `"sku": ""` (or a default/`{{variable}}` placeholder) in the **GraphQL Variables** JSON pane.
  - **Union & Interface Inline Fragment Builder (`... on Type`):**
    - Fields returning a GraphQL `Union` or `Interface` display expandable concrete member types in the Designer tree; checking fields under a member type automatically generates `... on ConcreteType { field }` inline fragments.
  - **Two-Way Live AST Synchronization (`Query Designer` ↔ `Monaco Editor`):**
    - Powered by `graphql` (`parse`, `print`, `visit`, `buildClientSchema`).
    - Clicking checkboxes/arguments in the **Query Designer** updates the Monaco Query & Variables editors in real time while preserving existing comments, aliases, directives (`@include`, `@skip`), and formatting.
    - Typing or editing the GraphQL query directly in the **Monaco Editor** parses the AST and immediately updates the checked fields, expanded nodes, and argument values in the **Query Designer** tree.
- **FR-4.4 Schema Explorer & Documentation Drawer:**
  - Searchable, hyperlinked documentation browser for all `Query`, `Mutation`, `Subscription`, `Object`, `Input`, `Enum`, `Scalar`, `Interface`, and `Union` types.
  - Displays markdown descriptions, argument types, return types, and `@deprecated(reason: ...)` badges/warnings.
  - **"Generate Query / Mutation" Action:** Click any operation in the Schema Explorer to scaffold a complete starter query/mutation (with typed `$variables` and sample JSON variable payload) into the active request or a new request tab.
- **FR-4.5 Dedicated Split Editor (Query + Variables + Fragments):**
  - **Query / Mutation / Subscription Pane:** Monaco editor with GraphQL syntax highlighting, `Prettify` formatting, live schema-driven autocomplete (fields, arguments, types, directives, and `{{environmentVariables}}`), hover type documentation, and inline red squiggly validation diagnostics against the discovered schema.
  - **Operation Selector:** When the editor document contains multiple named operations, a dropdown next to **Send** lets the user choose which `operationName` to execute.
  - **GraphQL Variables Pane:** Monaco JSON/YAML editor with schema-aware validation for the operation's `$variable` input types and full `{{variable}}` environment/secret interpolation before sending.
  - **Collection-Level Reusable Fragments:** Define shared GraphQL fragments (`fragment OrderFields on Order { ... }`) in the collection or request that can be inserted from the Query Designer.

### FR-5: Environments, Variables & Interpolation Engine
- **FR-5.1 Scoped Variables & Precedence:**
  Variables are resolved from lowest to highest precedence:
  1. **Global Variables** (app-level user defaults)
  2. **Collection Variables** (defined at the root of the `.awjc` file)
  3. **Active Environment Variables** (e.g., `local`, `dev`, `staging`, `prod` defined in the `.awjc` file)
  4. **Folder Variables** (defined on an ancestor folder)
  5. **Request / Runtime Captured Variables** (overrides or values extracted from previous responses)
  6. **Dynamic Built-in Variables:**
     - `{{$uuid}}` — Random UUID v4
     - `{{$timestamp}}` — Current Unix epoch seconds
     - `{{$timestampMs}}` — Current Unix epoch milliseconds
     - `{{$isoTimestamp}}` — Current ISO-8601 UTC timestamp
     - `{{$randomInt}}` — Random integer (`0–1000`)
     - `{{$randomEmail}}`, `{{$randomString}}`
- **FR-5.2 Universal `{{variable}}` Interpolation:**
  - Supported in: Request URL, Path Params, Query Params, Headers, Auth credentials (username, password, token, OAuth2 URLs, client ID, client secret, scopes), Request Body (JSON, XML, text, form fields), and GraphQL Query & Variables.
  - Nested variable resolution (up to configurable depth, e.g., `baseUrl: "{{protocol}}://{{host}}:{{port}}"`).
- **FR-5.3 Live Variable Hover & Preview:**
  - Highlighting `{{variableName}}` in the URL bar, headers, or editor shows whether the variable is resolved (green/blue) or unresolved (red/amber).
  - Hovering over `{{variableName}}` displays its resolved value in the currently selected environment, its source scope (Environment, Collection, Secret, or Dynamic), and a quick link to edit it.

### FR-6: Secrets Management & Local Security
- **FR-6.1 Secret Variable Type:**
  - Any variable in an Environment or Collection (as well as Auth passwords, API keys, and OAuth 2.0 `clientSecret` / tokens) can be marked as `secret: true`.
  - Secret values are masked (`••••••••`) by default in all UI tables and tooltips with an explicit eye-icon toggle to reveal.
- **FR-6.2 Never Commit Plaintext Secrets:**
  - When a variable or auth field is marked `secret: true`, the `.awjc` YAML file stores only the variable key and metadata (`secret: true`, `secretRef: "..."`) **without** writing the plaintext secret into the `.awjc` file.
  - Actual secret values are stored in:
    1. **OS Keychain via Electron `safeStorage`** (macOS Keychain, Windows DPAPI, Linux Secret Service / `libsecret`), keyed by `(collectionId, environmentName, variableKey)`.
    2. **Optional Local Secret Sidecar (`<collection-name>.secrets.awjc`):** An encrypted or gitignored local override file for portable local setups.
- **FR-6.3 `.gitignore` Guard:** Provide a one-click helper to generate/update `.gitignore` entries (`*.secrets.awjc`, `.env.secret*`) in the collection's folder.

### FR-7: Authentication & OAuth 2.0 Token Manager
- **FR-7.1 Auth Inheritance:**
  - Auth can be configured at the **Collection**, **Folder**, or **Request** level.
  - Child folders and requests default to `inherit` (inheriting auth from their nearest ancestor) or can override with `none` or a specific auth scheme.
- **FR-7.2 Supported Authentication Schemes:**
  1. **Inherit from Parent** (`inherit`)
  2. **No Auth** (`none`)
  3. **Bearer Token** (`bearer`): Token string (supports `{{variable}}`), customizable header prefix (default `Bearer`).
  4. **Basic Auth** (`basic`): `username` and `password` (supports `{{variable}}` and secret storage), automatically base64-encoded into `Authorization: Basic ...`.
  5. **API Key** (`apikey`): Custom `key` and `value` injected into either **Request Header** or **Query Parameter**.
  6. **Digest Auth** (`digest`): `username`, `password`, realm/nonce challenge-response handling.
  7. **AWS Signature v4** (`awsv4`): `accessKeyId`, `secretAccessKey`, `sessionToken`, `region`, `service`.
  8. **OAuth 2.0 (`oauth2`) — Full Token Acquisition & Management:**
     - **Supported Grant Types:**
       - **Resource Owner Password Credentials (`password`):** Sends `grant_type=password`, `username`, `password`, `client_id`, `client_secret` (optional), and `scope` to `accessTokenUrl`.
       - **Client Credentials (`client_credentials`):** Sends `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`, and optional `audience`/custom body params to `accessTokenUrl`.
       - **Authorization Code (`authorization_code` & `authorization_code_pkce`):** Opens a system or embedded browser window to `authorizationUrl`, listens on redirect callback, exchanges code (+ `code_verifier` for PKCE `S256`/`plain`) at `accessTokenUrl`.
       - **Refresh Token (`refresh_token`):** Exchanges `refresh_token` at `accessTokenUrl` for a fresh `access_token`.
     - **Client Authentication Method:** Send client credentials Either as **Basic Auth Header** (`Authorization: Basic base64(clientId:clientSecret)`) or **Request Body** (`client_id` & `client_secret` form fields).
     - **Custom Token Request Parameters:** Allow extra form parameters or headers required by identity providers (e.g., `audience`, `resource`, `tenant`).
     - **Token Lifecycle & UI Controls:**
       - **"Get New Token"** button directly in the Auth tab executes the OAuth 2.0 exchange and shows full diagnostic logs if the token endpoint returns an error.
       - **Token Inspector:** View the acquired `access_token`, `refresh_token`, `token_type`, `scope`, `expires_at` countdown, and decoded **JWT payload/claims** (header + body JSON) when the token is a JWT.
       - **Auto-Refresh:** Optional toggle to automatically refresh or re-fetch the token before sending a request if the cached token is expired or within 30 seconds of expiry.
       - **Secure Token Cache:** Acquired tokens are cached in memory and OS Keychain (`safeStorage`) per `(collection, environment, authProfile)`—never written in plaintext to `.awjc`.

### FR-8: Response Inspector & Diff Viewer
- **FR-8.1 Response Metrics Bar:**
  - HTTP status badge (`200 OK`, `201 Created`, `401 Unauthorized`, `500 Internal Server Error`) color-coded by status class (`2xx` green, `3xx` blue, `4xx` amber, `5xx` red).
  - Total elapsed time (`ms`) with hover popover showing phase breakdown: **DNS Lookup**, **TCP Connect**, **TLS Handshake**, **Waiting (TTFB)**, and **Content Download**.
  - Response size (uncompressed & transfer size in `B` / `KB` / `MB`).
- **FR-8.2 Multi-Mode Response Body Viewer:**
  - **Pretty:** Auto-formatted Monaco viewer (JSON, XML, HTML, YAML, GraphQL response).
  - **Raw:** Exact unformatted response payload string.
  - **Preview / Visual:** Sandboxed HTML preview, SVG/image rendering (`png`, `jpg`, `webp`, `gif`, `svg`), and PDF/binary download prompt.
  - **Filter & Search:** Built-in find (`Cmd/Ctrl+F`) plus live **JSONPath** expression filter bar (e.g., `$.data.items[?(@.active==true)].id`) to slice large JSON responses.
- **FR-8.3 Headers, Cookies & Timeline Tabs:**
  - **Headers Tab:** Key-value table of response headers with quick copy.
  - **Cookies Tab:** Parsed `Set-Cookie` attributes (`Name`, `Value`, `Domain`, `Path`, `Expires`, `HttpOnly`, `Secure`, `SameSite`).
  - **Network / TLS Tab:** Remote IP address, HTTP protocol version, TLS version, cipher suite, certificate subject/issuer/validity, and redirect chain history.
- **FR-8.4 Response Comparison (Diff View):**
  - Pin a baseline response or compare two responses side-by-side using Monaco's built-in Diff Editor (e.g., comparing `staging` vs `prod` or before/after a code change).

### FR-9: Declarative Variable Extraction & Assertions (Post-Response)
- **FR-9.1 Declarative Response Captures (No-Code Chaining):**
  - Users can extract values from a response and store them directly into Environment or Collection variables using a simple table:
    - Example: Set `userId` from `body.jsonpath` `$.data.user.id`
    - Example: Set `csrfToken` from `header` `x-csrf-token`
    - Example: Set `sessionCookie` from `cookie` `SID`
- **FR-9.2 Declarative Assertions (Request Tests):**
  - Define assertions in a clean table stored in the `.awjc` request definition:
    - `status` `equals` `200`
    - `responseTime` `lessThan` `500`
    - `header.content-type` `contains` `application/json`
    - `jsonpath($.data.items.length)` `greaterThan` `0`
  - Results appear in the **Tests (`Pass / Fail`)** tab of the Response Inspector immediately after every run.

### FR-10: Collection Runner & Request History
- **FR-10.1 Collection / Folder Runner:**
  - Run all requests in a collection or specific folder sequentially against a chosen Environment.
  - Configurable delay between requests (`ms`), stop-on-error toggle, and iteration count.
  - Aggregate report showing passed/failed assertions, status codes, durations, and exportable JSON/HTML summary.
- **FR-10.2 Local Request History:**
  - Automatic history log of executed requests with timestamp, status code, duration, and one-click **Restore Request** or **Save to Collection**.

### FR-11: Import, Export & Code Snippet Generation
- **FR-11.1 `curl` Import & Paste-to-Import:**
  - Pasting a `curl` command directly into the URL bar (or via `File -> Import -> Paste cURL`) automatically parses the HTTP method, URL, query params, headers, `-u` basic auth, and `-d` / `--data-raw` / `-F` body into a ready-to-run request.
- **FR-11.2 OpenAPI 3.x / Swagger 2.0 & HAR Import:**
  - Import an OpenAPI (`.yaml` / `.json`) specification or HAR file to generate a structured `.awjc` collection with folders, sample payloads, and `{{baseUrl}}` environment variable.
- **FR-11.3 Code Generator:**
  - Generate ready-to-copy code snippets for the active request (with an option to either keep `{{variables}}` or inline resolved values):
    - `curl` (bash & PowerShell)
    - JavaScript / TypeScript (`fetch`, `axios`)
    - Python (`requests`, `httpx`)
    - Go (`net/http`)
    - C# (`HttpClient`)
    - Rust (`reqwest`)

### FR-12: Future-Ready Git Integration (Phase 4 Roadmap)
- Because every collection is stored locally as a deterministic YAML `.awjc` file and secrets are stored outside the file in OS Keychain / gitignored sidecar:
  - Users can immediately use standard `git` CLI or GUI clients on their collection folders.
  - Future in-app Git panel will provide branch indicator, visual YAML diff of `.awjc` changes, stage/commit, and push/pull directly from AwapiLasso.

---

## 4. Non-Functional Requirements

### NFR-1: Performance & Resource Footprint
- Cold startup time under **1.5 seconds** on modern macOS, Windows, and Linux hardware.
- Capable of rendering large JSON responses (10 MB+) smoothly via Monaco virtualization without freezing the UI thread.
- Streaming/chunked response size protection (configurable max in-memory preview threshold, e.g., 50 MB, with automatic "Save to Disk" prompt for huge binary downloads).

### NFR-2: Security & Privacy
- **Zero Telemetry:** AwapiLasso makes zero background network calls other than optional GitHub Release update checks (`https://api.github.com/repos/awapi/awapi-lasso/releases/latest`, toggleable in Preferences) and the explicit HTTP/OAuth requests initiated by the user.
- **Strict Process Isolation:** `nodeIntegration: false`, `contextIsolation: true`, and strict Content Security Policy (CSP) in the renderer.
- **Sandboxed HTML Preview:** HTML response previews must render inside a sandboxed `iframe` (`sandbox=""`) with scripts and network access disabled so malicious API responses cannot execute XSS in the app.

### NFR-3: Cross-Platform UI & Accessibility
- Native Dark and Light themes synced with OS `nativeTheme` (or overridden in **Preferences**).
- Platform-aware keyboard shortcuts (`Cmd` on macOS, `Ctrl` on Windows/Linux):
  - `Cmd/Ctrl+Enter`: Send Request
  - `Cmd/Ctrl+N`: New Request Tab
  - `Cmd/Ctrl+S`: Save Request / Collection
  - `Cmd/Ctrl+O`: Open `.awjc` Collection File
  - `Cmd/Ctrl+E`: Quick Switch Environment
  - `Cmd/Ctrl+K` or `F1`: Command Palette
  - `Cmd/Ctrl+W`: Close Active Tab
  - `Cmd/Ctrl+Shift+T`: Reopen Closed Tab
