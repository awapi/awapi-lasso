# Authoring `.awjc` Collections with an AI Agent / LLM

This guide is written **for LLMs and coding agents** (and the humans who prompt them). Point your agent at this file and ask it to generate an AwapiLasso collection for your REST or GraphQL API. The result opens directly in AwapiLasso (double-click, or **File → Open**).

- Full schema reference: [`file-format-spec.md`](./file-format-spec.md)
- Source of truth for types and validation: [`src/shared/collectionSchema.ts`](../src/shared/collectionSchema.ts)

> **Raw URL to give an agent on another machine:**
> `https://raw.githubusercontent.com/awapi/awapi-lasso/main/docs/ai-authoring-guide.md`

## Example prompt

```text
Read https://raw.githubusercontent.com/awapi/awapi-lasso/main/docs/ai-authoring-guide.md
Then generate an AwapiLasso collection for this GraphQL API (schema: ./schema.graphql,
endpoint: https://api.example.com/graphql, bearer-token auth). One request per query and
mutation, grouped in folders. Save it as ./api/example.awjc
```

## File basics

| Item | Rule |
|---|---|
| Extension | `.awjc` (preferred) or `.awj` — identical format |
| Encoding | UTF-8 YAML (JSON is also valid, since JSON is YAML) |
| One file | One collection per file; everything (environments, auth, folders, requests) lives inside it |
| Indentation | 2 spaces |
| Sidecar | `<name>.secrets.awjc` holds local secret values; it is gitignored. **Never create it with real secrets for the user** |

## Required fields (the app rejects the file without these)

Root: `awapiLasso: "1.0"`, `kind: Collection`, `metadata.id`, `metadata.name`, `items` (array).

Folder: `kind: folder`, `id`, `name`, `items` (array, may be empty).

Request: `kind: request`, `id`, `name`, `protocol` (`http` | `graphql`), `method`, `url`.

All `id` values must be **unique within the file**. Use readable ids with a prefix, e.g. `col_orders`, `fld_users`, `req_get_user`, `env_local`.

## Minimal template (copy and extend)

```yaml
awapiLasso: "1.0"
kind: Collection
metadata:
  id: "col_example"
  name: "Example API"
  description: "Generated collection"
defaults:
  baseUrl: "{{baseUrl}}"
  timeoutMs: 30000
  followRedirects: true
  verifySsl: true
  headers:
    - key: "Accept"
      value: "application/json"
      enabled: true
  auth:
    type: bearer
    bearer:
      token: "{{apiToken}}"
      prefix: "Bearer"
activeEnvironment: "local"
environments:
  - id: "env_local"
    name: "local"
    color: "#22c55e"
    variables:
      - key: "baseUrl"
        value: "http://localhost:8080"
        enabled: true
      - key: "apiToken"
        secret: true # no value here; the user fills it in the app
        enabled: true
items:
  - kind: folder
    id: "fld_users"
    name: "Users"
    items:
      - kind: request
        id: "req_get_user"
        name: "Get User"
        protocol: http
        method: GET
        url: "{{baseUrl}}/users/:userId"
        pathParams:
          - key: "userId"
            value: "42"
        queryParams:
          - key: "expand"
            value: "profile"
            enabled: true
        auth:
          type: inherit
        body:
          mode: none
        assertions:
          - target: status
            operator: equals
            expected: 200
```

## HTTP request recipes

**JSON body**

```yaml
- kind: request
  id: "req_create_user"
  name: "Create User"
  protocol: http
  method: POST
  url: "{{baseUrl}}/users"
  headers:
    - key: "Content-Type"
      value: "application/json"
      enabled: true
  auth:
    type: inherit
  body:
    mode: json
    content: |
      {
        "email": "{{$randomEmail}}",
        "name": "Jane Doe"
      }
  captures:
    - variable: "userId"
      scope: environment
      source: jsonpath
      expression: "$.id"
  assertions:
    - target: status
      operator: in
      expected: [200, 201]
```

**Body modes:** `none`, `json`, `yaml`, `xml`, `html`, `text` (use `content`), `form-urlencoded` (use `urlEncoded: [{key, value, enabled}]`), `multipart-form` (use `formData: [{key, type: text|file, value | filePath, enabled}]`), `binary` (use `binaryFilePath`).

## GraphQL request recipe

GraphQL requests use `protocol: graphql`, `method: POST`, and a `graphql` block. Do **not** use `body` — the app builds `{ query, variables, operationName }` itself and sets `Content-Type: application/json` when absent.

```yaml
- kind: request
  id: "req_gql_get_user"
  name: "Get User"
  protocol: graphql
  method: POST
  url: "{{baseUrl}}/graphql"
  auth:
    type: inherit
  graphql:
    operationName: "GetUser"
    schemaSource:
      mode: introspect # introspect | sdl_file | json_file
      autoIntrospectOnOpen: true
      localSchemaPath: "" # set to e.g. "./schema.graphql" when mode is sdl_file / json_file
    query: |
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          email
        }
      }
    variables: |
      {
        "id": "42"
      }
  assertions:
    - target: status
      operator: equals
      expected: 200
    - target: jsonpath
      path: "$.errors"
      operator: isUndefined
```

Guidance when generating from a schema:

- One request per query/mutation (subscriptions are not executed over HTTP; skip them).
- `query` and `variables` are **strings** (use a YAML `|` block). `variables` must be valid JSON.
- Include sensible sample variable values so the request runs as-is.
- Use `schemaSource.mode: sdl_file` with a **relative** `localSchemaPath` when a `.graphql` file is in the repo; otherwise use `introspect`.
- Group requests in folders such as `Queries` and `Mutations`, or by domain.

## Authentication

`auth.type` is one of `inherit`, `none`, `profile`, `bearer`, `basic`, `apikey`, `digest`, `awsv4`, `oauth2`.

- Requests and folders normally use `auth: { type: inherit }`; set the real auth once in `defaults.auth`.
- Reusable setups go in `authProfiles` (each has `id`, `name`, plus the auth fields) and are referenced with `auth: { type: profile, profileId: "<id>" }`.

| Type | Shape |
|---|---|
| `bearer` | `bearer: { token: "{{apiToken}}", prefix: "Bearer" }` |
| `basic` | `basic: { username: "{{user}}", password: "{{pass}}" }` |
| `apikey` | `apikey: { key: "X-API-Key", value: "{{apiKey}}", in: header }` (`in: query` also allowed) |
| `oauth2` | `oauth2: { grantType, accessTokenUrl, clientId, clientSecret, scope, clientAuthMethod, autoRefresh, ... }` |

OAuth 2.0 `grantType`: `client_credentials`, `password` (adds `username`/`password`), `authorization_code`, `authorization_code_pkce` (both need `authorizationUrl` and `redirectUri`), `refresh_token`. `clientAuthMethod`: `basic_header` or `request_body`.

## Variables, environments, and secrets

- Reference variables as `{{name}}` in URLs, headers, query/path params, auth fields, bodies, and GraphQL query/variables.
- Built-ins: `{{$uuid}}`, `{{$timestamp}}`, `{{$timestampMs}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`, `{{$randomString}}`.
- Put per-target values (`baseUrl`, ids, usernames) in `environments[].variables`; declare an environment per target (`local`, `staging`, `prod`) and set `activeEnvironment` to one of their `name`s.
- Path params: write `:name` in the URL and list it under `pathParams`.

**Secrets — hard rules for agents**

1. Never write a real password, token, API key, or client secret into the file.
2. For any sensitive variable, emit `secret: true` and **omit `value`**:
   ```yaml
   - key: "apiToken"
     secret: true
     enabled: true
   ```
3. Prefer referencing secrets through variables (`token: "{{apiToken}}"`) rather than inlining them in auth blocks.
4. Tell the user which secret variables they must fill in after opening the file.

(If a plaintext value is present on a `secret: true` entry, the app moves it to the OS Keychain and strips it on save — but do not rely on that.)

**Private but not secret:** add `hideFromAi: true` to a variable, header, query param or url-encoded body field to keep its value in the file but hidden from the in-app AI assistant (for example account ids or internal hosts). Only emit it when the user asks for it:

```yaml
- kind: request
  id: "req_tenant_users"
  name: "List tenant users"
  protocol: http
  method: GET
  url: "{{baseUrl}}/users"
  headers:
    - key: "X-Tenant"
      value: "acme-internal"
      enabled: true
      hideFromAi: true
```

## Captures and assertions

Captures save response data into a variable for later requests:

```yaml
captures:
  - variable: "token"
    scope: environment # environment | collection | runtime
    source: jsonpath # jsonpath | header | cookie | status | body
    expression: "$.data.token"
```

Assertions:

```yaml
assertions:
  - target: status # status | responseTime | header | jsonpath | body
    operator: equals
    expected: 200
  - target: jsonpath
    path: "$.items"
    operator: isArray
  - target: header
    headerName: "Content-Type"
    operator: contains
    expected: "json"
```

Operators: `equals`, `notEquals`, `contains`, `notContains`, `matchesRegex`, `lessThan`, `greaterThan`, `in` (expected is an array), `isDefined`, `isUndefined`, `isEmpty`, `isNotEmpty`, `isArray`.

## Conventions and gotchas

- Always write `enabled: true` on key/value entries (headers, queryParams, urlEncoded, formData, variables). Omitting it is tolerated, but the type requires it.
- `pathParams` entries do **not** have `enabled`.
- Order requests logically (auth/login first, then reads, then writes) so captures feed later requests.
- Keep `id`s stable and unique; never reuse an `id` across folders, requests, environments, or profiles.
- Quote strings containing `{{ }}`, `:` or `#` (e.g. `"{{baseUrl}}/users"`).
- File paths (`filePath`, `binaryFilePath`, `localSchemaPath`) should be relative to the collection file.
- Prefer generating from an authoritative source (OpenAPI spec, GraphQL SDL, existing code) over guessing endpoints.

## Pre-save checklist for the agent

- [ ] Root has `awapiLasso`, `kind: Collection`, `metadata.id`, `metadata.name`, `items`
- [ ] Every folder/request has unique `id` and a `name`; every request has `protocol`, `method`, `url`
- [ ] GraphQL requests use the `graphql` block (not `body`), with string `query` / JSON-string `variables`
- [ ] No plaintext secrets; sensitive variables are `secret: true` with no `value`
- [ ] Every `{{variable}}` used is defined in an environment, collection `variables`, a capture, or is a built-in
- [ ] File saved with `.awjc` (or `.awj`) extension and parses as YAML
