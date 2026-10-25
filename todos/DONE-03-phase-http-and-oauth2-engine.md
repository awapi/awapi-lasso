# Phase 03 — Main-Process HTTP Engine, Auth Inheritance & OAuth 2.0 Token Manager

## Objective
Build the Node.js Main-process HTTP/HTTPS execution engine (zero CORS restrictions, full phase timings, TLS inspection, multipart/binary payloads), hierarchical authentication injector, full **OAuth 2.0 Token Manager** (`password`, `client_credentials`, `authorization_code` + PKCE, `refresh_token`), and declarative post-response captures/assertions.

---

## Tasks Checklist

- [x] **T3.1 — Node.js HTTP / HTTPS Execution Engine**
  - Create `src/main/httpEngine.ts` + `src/main/httpEngine.test.ts`:
    - Execute `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS`, `TRACE`, `CONNECT`, and custom HTTP verbs natively in Node.js.
    - Support all request body modes:
      - `none`
      - `json`, `yaml`, `xml`, `text` (with automatic `Content-Type` header if not explicitly set)
      - `form-urlencoded` (`application/x-www-form-urlencoded`)
      - `multipart-form` (`multipart/form-data` supporting both text fields and local file streams)
      - `binary` (stream local file payload)
    - Capture high-resolution timing breakdown (`dnsMs`, `tcpMs`, `tlsMs`, `ttfbMs`, `downloadMs`, `totalMs`), payload byte size, response headers, parsed `Set-Cookie` attributes, peer TLS certificate details (`issuer`, `subject`, `validFrom`, `validTo`, `protocol`, `cipher`), and redirect chain hops.
    - Support in-flight cancellation via `AbortController` (`requestId`), configurable timeout (`timeoutMs`), follow-redirects toggle, and SSL verification toggle (`verifySsl`).

- [x] **T3.2 — Auth Inheritance & Request Auth Injector**
  - Create `src/main/authEngine.ts` + `src/main/authEngine.test.ts`:
    - Resolve effective authentication by walking `Request -> Ancestor Folders -> Collection Defaults -> Named Auth Profile (authProfiles)`.
    - Implement auth injectors (after `{{variable}}` interpolation):
      - `bearer` (`Authorization: <prefix> <token>`)
      - `basic` (`Authorization: Basic <base64(username:password)>`)
      - `apikey` (inject `key: value` into Request Header or Query Parameter)
      - `digest` (challenge-response MD5/SHA-256 Digest header)
      - `awsv4` (AWS Signature v4 header signing)

- [x] **T3.3 — OAuth 2.0 Token Acquisition Engine, Cache & JWT Decoder**
  - Create `src/main/oauth2Engine.ts` + `src/main/oauth2Engine.test.ts`:
    - Support all 4 OAuth 2.0 grant types with full `{{variable}}` interpolation in URLs, credentials, scopes, and `extraParams`:
      1. **Resource Owner Password Credentials (`password`):** `grant_type=password`, `username`, `password`, `client_id`, `client_secret`, `scope`, and `extraParams`.
      2. **Client Credentials (`client_credentials`):** `grant_type=client_credentials`, `client_id`, `client_secret`, `scope`, and `extraParams` (e.g., `audience`, `resource`).
      3. **Authorization Code (`authorization_code` & `authorization_code_pkce`):** Generate PKCE `code_verifier` & `code_challenge` (`S256` / `plain`), open auth URL, capture callback code via local loopback listener, and exchange at `accessTokenUrl`.
      4. **Refresh Token (`refresh_token`):** Exchange `refresh_token` at `accessTokenUrl`.
    - Support both `basic_header` (`Authorization: Basic base64(clientId:clientSecret)`) and `request_body` (`client_id` & `client_secret` form fields) client authentication methods.
    - Cache acquired tokens in memory + `secretStore` (`safeStorage`) keyed by `(collectionId, environmentId, profileOrRequestId)`.
    - Automatically refresh or re-acquire expired tokens before sending a request when `autoRefresh: true`.
    - Implement `decodeJwtToken(token: string)` to safely parse JWT header, payload claims (`exp`, `iat`, `sub`, `aud`, `scp`/`scope`), and expiration status for the UI inspector.

- [x] **T3.4 — Post-Response Variable Captures & Assertions Evaluator**
  - Create `src/shared/captures.ts` + `src/shared/captures.test.ts`:
    - Extract values from response `jsonpath` (e.g., `$.data.id`, `$.access_token`), `header`, or `cookie` into Environment or Collection variables.
  - Create `src/shared/assertions.ts` + `src/shared/assertions.test.ts`:
    - Evaluate declarative assertions (`status`, `responseTime`, `header`, `jsonpath`) with operators (`equals`, `notEquals`, `contains`, `lessThan`, `greaterThan`, `in`, `isArray`, `isNotEmpty`, `isUndefined`).

- [x] **T3.5 — Wire HTTP & OAuth 2.0 IPC Channels**
  - Register `http:send`, `http:cancel`, `oauth2:getToken`, `oauth2:refreshToken`, `oauth2:getCachedToken`, `oauth2:clearToken` in `src/main/main.ts`, `src/preload/index.ts`, and `src/preload/globals.d.ts`.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
```

---

## Agent Prompt for Phase 03
```markdown
Execute Phase 03 (`todos/03-phase-http-and-oauth2-engine.md`) following `AGENTS.md`, `docs/requirements.md` (FR-3, FR-7, FR-8, FR-9), and `.agents/skills/electron-ipc/SKILL.md`. Test `httpEngine` and `oauth2Engine` against ephemeral local Node `http.createServer` test servers, check off completed tasks in `todos/03-phase-http-and-oauth2-engine.md`, and verify `pnpm run typecheck && pnpm run test` pass.
```
