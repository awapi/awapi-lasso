# `.awjc` / `.awj` Collection File Format Specification

## Overview

AwapiLasso stores each API collection in a **single, self-contained local file** using the **`.awjc`** extension (*AwapiLasso Collection*) or its short alias **`.awj`**.

- **Primary Serialization:** Clean, human-readable **YAML 1.2** (2-space indentation, deterministic field ordering).
- **JSON Compatibility:** AwapiLasso also accepts valid JSON inside `.awjc` / `.awj` files and can export to JSON on demand.
- **Click-to-Open:** Both `.awjc` and `.awj` are registered with the operating system (macOS Finder, Windows Explorer, Linux desktop environments) so double-clicking a collection file opens it directly in AwapiLasso.
- **Git-Safe Secrets:** Sensitive values (passwords, API keys, OAuth 2.0 `clientSecret`, cached access/refresh tokens) are **never** written in plaintext to the `.awjc` file. Instead, secret variables declare `secret: true` and resolve their values from the OS Keychain (`safeStorage`) or a gitignored `<collection>.secrets.awjc` sidecar file.

---

## File Extensions & MIME Types

| Extension | Purpose | OS Description | MIME Type |
|---|---|---|---|
| **`.awjc`** | Primary extension for an AwapiLasso Collection file | `AwapiLasso Collection` | `application/x-awapi-lasso-collection` |
| **`.awj`** | Short alias supported identically for opening/saving collections | `AwapiLasso Collection` | `application/x-awapi-lasso` |
| **`.secrets.awjc`** | Optional local gitignored sidecar file for non-keychain local secrets | `AwapiLasso Local Secrets` | `application/x-awapi-lasso-secrets` |

---

## Complete `.awjc` YAML Example

Below is a complete, realistic example of a single-file `.awjc` collection demonstrating environments, variables, secret references, OAuth 2.0 (`password` and `client_credentials` flows), nested folders, RESTful requests, Multipart uploads, GraphQL requests, declarative response captures, and assertions:

```yaml
awapiLasso: "1.0"
kind: Collection
metadata:
  id: "col_orders_platform_01"
  name: "Orders & Inventory API"
  description: "REST and GraphQL endpoints for the Orders & Inventory service"
  createdAt: "2026-10-24T12:00:00Z"
  updatedAt: "2026-10-24T15:30:00Z"

# Collection-wide default settings (inherited by folders and requests unless overridden)
defaults:
  baseUrl: "{{baseUrl}}"
  timeoutMs: 30000
  followRedirects: true
  verifySsl: true
  headers:
    - key: "Accept"
      value: "application/json"
      enabled: true
    - key: "X-Client-App"
      value: "AwapiLasso/1.0"
      enabled: true
  # Default collection-level authentication (requests with auth.type = 'inherit' use this)
  auth:
    type: oauth2
    oauth2:
      grantType: client_credentials
      accessTokenUrl: "{{authBaseUrl}}/oauth/token"
      clientId: "{{clientId}}"
      clientSecret: "{{clientSecret}}"
      scope: "orders:read orders:write"
      clientAuthMethod: basic_header # 'basic_header' | 'request_body'
      tokenHeaderPrefix: "Bearer"
      autoRefresh: true
      extraParams:
        - key: "audience"
          value: "https://api.example.com"
          enabled: true

# Named OAuth 2.0 / Auth profiles that any folder or request can reference or override
authProfiles:
  - id: "auth_service_cc"
    name: "Service Account (Client Credentials)"
    type: oauth2
    oauth2:
      grantType: client_credentials
      accessTokenUrl: "{{authBaseUrl}}/oauth/token"
      clientId: "{{clientId}}"
      clientSecret: "{{clientSecret}}"
      scope: "orders:read orders:write"
      clientAuthMethod: basic_header
      autoRefresh: true

  - id: "auth_user_password"
    name: "User Login (OAuth2 Password Grant)"
    type: oauth2
    oauth2:
      grantType: password
      accessTokenUrl: "{{authBaseUrl}}/oauth/token"
      clientId: "{{clientId}}"
      clientSecret: "{{clientSecret}}"
      username: "{{apiUsername}}"
      password: "{{apiPassword}}"
      scope: "openid profile orders:admin"
      clientAuthMethod: request_body
      autoRefresh: true

# Collection-scoped default variables (lowest precedence before active environment)
variables:
  - key: "apiVersion"
    value: "v1"
    enabled: true
    description: "Default API version path segment"

# Environments selectable from the top toolbar dropdown
activeEnvironment: "local"
environments:
  - id: "env_local"
    name: "local"
    color: "#22c55e"
    variables:
      - key: "baseUrl"
        value: "http://localhost:8080"
        enabled: true
      - key: "authBaseUrl"
        value: "http://localhost:9000"
        enabled: true
      - key: "clientId"
        value: "local-dev-client"
        enabled: true
      - key: "clientSecret"
        secret: true
        enabled: true
        description: "Stored in OS Keychain / local secrets sidecar"
      - key: "apiUsername"
        value: "admin@example.local"
        enabled: true
      - key: "apiPassword"
        secret: true
        enabled: true

  - id: "env_production"
    name: "production"
    color: "#ef4444"
    variables:
      - key: "baseUrl"
        value: "https://api.example.com"
        enabled: true
      - key: "authBaseUrl"
        value: "https://auth.example.com"
        enabled: true
      - key: "clientId"
        value: "prod-orders-client"
        enabled: true
      - key: "clientSecret"
        secret: true
        enabled: true
      - key: "apiUsername"
        value: "ops@example.com"
        enabled: true
      - key: "apiPassword"
        secret: true
        enabled: true

# Hierarchical tree of folders and requests
items:
  - kind: folder
    id: "fld_orders"
    name: "Orders REST API"
    description: "CRUD endpoints for customer orders"
    auth:
      type: inherit
    headers: []
    items:
      - kind: request
        id: "req_list_orders"
        name: "List Orders"
        protocol: http
        method: GET
        url: "{{baseUrl}}/{{apiVersion}}/orders"
        queryParams:
          - key: "status"
            value: "pending"
            enabled: true
            description: "Filter by order status"
          - key: "limit"
            value: "25"
            enabled: true
        headers:
          - key: "X-Correlation-Id"
            value: "{{$uuid}}"
            enabled: true
        auth:
          type: inherit
        body:
          mode: none
        assertions:
          - target: status
            operator: equals
            expected: 200
          - target: responseTime
            operator: lessThan
            expected: 1000
          - target: jsonpath
            path: "$.data"
            operator: isArray

      - kind: request
        id: "req_create_order"
        name: "Create Order"
        protocol: http
        method: POST
        url: "{{baseUrl}}/{{apiVersion}}/orders"
        headers:
          - key: "Content-Type"
            value: "application/json"
            enabled: true
        # Override folder auth to use the OAuth2 Password Grant profile
        auth:
          type: profile
          profileId: "auth_user_password"
        body:
          mode: json
          content: |
            {
              "customerId": "cust_901",
              "currency": "USD",
              "requestedAt": "{{$isoTimestamp}}",
              "items": [
                {
                  "sku": "SKU-100",
                  "quantity": 2
                }
              ]
            }
        # Capture values from the response into variables for subsequent requests
        captures:
          - variable: "lastOrderId"
            scope: environment
            source: jsonpath
            expression: "$.data.id"
        assertions:
          - target: status
            operator: in
            expected: [200, 201]
          - target: jsonpath
            path: "$.data.id"
            operator: isNotEmpty

      - kind: request
        id: "req_get_order_by_id"
        name: "Get Order by ID"
        protocol: http
        method: GET
        url: "{{baseUrl}}/{{apiVersion}}/orders/:orderId"
        pathParams:
          - key: "orderId"
            value: "{{lastOrderId}}"
            description: "Order ID captured from Create Order"
        auth:
          type: inherit
        body:
          mode: none
        assertions:
          - target: status
            operator: equals
            expected: 200

      - kind: request
        id: "req_upload_invoice"
        name: "Upload Invoice Attachment"
        protocol: http
        method: POST
        url: "{{baseUrl}}/{{apiVersion}}/orders/:orderId/attachments"
        pathParams:
          - key: "orderId"
            value: "{{lastOrderId}}"
        auth:
          type: inherit
        body:
          mode: multipart-form
          formData:
            - key: "documentType"
              type: text
              value: "invoice"
              enabled: true
            - key: "file"
              type: file
              filePath: "./samples/invoice.pdf"
              enabled: true

  - kind: folder
    id: "fld_graphql"
    name: "Inventory GraphQL API"
    items:
      - kind: request
        id: "req_gql_inventory"
        name: "Query Warehouse Stock"
        protocol: graphql
        method: POST
        url: "{{baseUrl}}/graphql"
        auth:
          type: inherit
        graphql:
          operationName: "GetWarehouseStock"
          # Schema discovery & Query Designer preferences for this request
          schemaSource:
            mode: introspect # 'introspect' | 'sdl_file' | 'json_file'
            autoIntrospectOnOpen: true
            localSchemaPath: "" # Optional fallback path to .graphql / .json schema when introspection is disabled
          query: |
            query GetWarehouseStock($sku: ID!, $warehouseId: ID) {
              inventoryItem(sku: $sku, warehouseId: $warehouseId) {
                sku
                name
                availableQuantity
                reservedQuantity
                updatedAt
              }
            }
          variables: |
            {
              "sku": "SKU-100",
              "warehouseId": "WH-EAST-01"
            }
        assertions:
          - target: status
            operator: equals
            expected: 200
          - target: jsonpath
            path: "$.errors"
            operator: isUndefined
```

---

## Schema Reference

### 1. Root Document (`AwjcCollection`)
| Field | Type | Required | Description |
|---|---|---|---|
| `awapiLasso` | `string` | Yes | Schema version string (currently `"1.0"`). |
| `kind` | `"Collection"` | Yes | Discriminator identifying an AwapiLasso collection file. |
| `metadata` | `CollectionMetadata` | Yes | `id`, `name`, `description`, `createdAt`, `updatedAt`. |
| `defaults` | `CollectionDefaults` | No | Default `baseUrl`, `timeoutMs`, `followRedirects`, `verifySsl`, `headers`, and `auth`. |
| `authProfiles` | `AuthProfile[]` | No | Reusable named authentication / OAuth 2.0 configurations. |
| `variables` | `VariableEntry[]` | No | Collection-scoped variables. |
| `activeEnvironment` | `string` | No | Name or ID of the currently selected environment. |
| `environments` | `EnvironmentConfig[]` | No | List of environments (`local`, `dev`, `staging`, `prod`, etc.). |
| `items` | `Array<FolderItem \| RequestItem>` | Yes | Ordered tree of folders and requests. |

### 2. Authentication Configuration (`AuthConfig`)
Supported `auth.type` values:
- `inherit` — Inherit authentication from the parent Folder or Collection.
- `none` — Send no authentication headers/params.
- `profile` — Use a named entry from `authProfiles` by `profileId`.
- `bearer` — `{ token: string, prefix?: string }`
- `basic` — `{ username: string, password: string }`
- `apikey` — `{ key: string, value: string, in: 'header' | 'query' }`
- `digest` — `{ username: string, password: string, realm?: string }`
- `awsv4` — `{ accessKeyId: string, secretAccessKey: string, sessionToken?: string, region: string, service: string }`
- `oauth2` — Full OAuth 2.0 configuration:
  - `grantType`: `'password' | 'client_credentials' | 'authorization_code' | 'authorization_code_pkce' | 'refresh_token'`
  - `accessTokenUrl`: Token endpoint URL (supports `{{variables}}`)
  - `authorizationUrl`: Used for `authorization_code` / PKCE flows
  - `redirectUri`: Callback URL for `authorization_code` flows (e.g., `http://127.0.0.1:17890/callback`)
  - `clientId`: OAuth client ID (supports `{{variables}}`)
  - `clientSecret`: OAuth client secret (supports `{{variables}}` or `secret: true`)
  - `username` / `password`: Used when `grantType === 'password'` (supports `{{variables}}`)
  - `scope`: Space-delimited OAuth scopes
  - `clientAuthMethod`: `'basic_header'` (`Authorization: Basic ...`) or `'request_body'` (`client_id` & `client_secret` in form body)
  - `tokenHeaderPrefix`: Header prefix when injecting token (default `"Bearer"`)
  - `autoRefresh`: Automatically refresh or re-acquire expired token before request execution
  - `extraParams`: Additional key-value form parameters sent to the token endpoint (e.g., `audience`, `resource`)

### 3. Secrets Resolution Strategy
When saving a collection to `.awjc`:
1. Any variable with `secret: true` has its `value` omitted from the `.awjc` file on disk.
2. The secret value is persisted in the OS Keychain via Electron's `safeStorage.encryptString()` (stored in the app's userData vault indexed by `collectionId + environmentId + variableKey`) or in an optional `<filename>.secrets.awjc` local file.
3. At request execution time (or when previewing a hovered variable), the Main process resolves all `{{variable}}` placeholders by merging non-secret values from the `.awjc` document with secret values from the OS Keychain / local secrets store.

---

## OS File Association Configuration (`electron-builder`)

In `package.json` under `build.fileAssociations`, configure both `.awjc` and `.awj` so double-clicking either extension opens AwapiLasso across macOS, Windows, and Linux:

```json
"fileAssociations": [
  {
    "ext": "awjc",
    "name": "AwapiLasso Collection",
    "description": "AwapiLasso API Collection File",
    "mimeType": "application/x-awapi-lasso-collection",
    "role": "Editor",
    "icon": "build/icon"
  },
  {
    "ext": "awj",
    "name": "AwapiLasso Collection",
    "description": "AwapiLasso API Collection File",
    "mimeType": "application/x-awapi-lasso",
    "role": "Editor",
    "icon": "build/icon"
  }
]
```

### Handling File Open Events Across Platforms in `src/main/main.ts`
1. **macOS (`app.on('open-file', (event, filePath) => ...)`):**
   - Triggered when a user double-clicks a `.awjc` or `.awj` file in Finder or drags it onto the Dock icon.
   - If `mainWindow` is already ready, send `collection:openFromPath` over IPC; if launched cold, queue `filePath` until `mainWindow` finishes loading.
2. **Windows & Linux (`process.argv` + `app.on('second-instance', ...)`):**
   - Enforce single-instance lock via `app.requestSingleInstanceLock()`.
   - Extract `.awjc` / `.awj` file paths from `process.argv` on cold start and from `second-instance`'s `commandLine` when the app is already running, focus `mainWindow`, and open the collection immediately.
