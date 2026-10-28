# AwapiLasso Sample REST + GraphQL + OAuth 2.0 API (`sample-api/`)

A self-contained, zero-external-dependency mock API server designed for:
1. **Manual Desktop Testing:** Testing all RESTful HTTP verbs, GraphQL queries/mutations/introspection, OAuth 2.0 token flows, authentication schemes, multipart file uploads, cookies, redirects, and response assertions in **AwapiLasso** using [`samples/orders-and-inventory.awjc`](../samples/orders-and-inventory.awjc).
2. **Automated Integration Tests:** Programmatically starting an ephemeral server (`port = 0`) in Vitest (`sample-api/server.test.ts`) to run end-to-end collection and engine integration tests.

---

## Quick Start

### 1. Combined with AwapiLasso Desktop (`just dev`)
Running `just dev` (or `pnpm run dev`) **automatically starts both AwapiLasso and the Sample API** on `http://127.0.0.1:8080` inside the Vite dev process (closing cleanly when you exit):

```bash
just dev
# Optional overrides:
# SAMPLE_API_PORT=8787 just dev   # Use a custom port
# NO_SAMPLE_API=1 just dev        # Disable auto-starting the sample API
```

### 2. Standalone Server Only
If you ever want to run the mock server by itself without launching Electron:

```bash
just sample-api
# or
pnpm run sample-api
```

Then open [`samples/orders-and-inventory.awjc`](../samples/orders-and-inventory.awjc) in **AwapiLasso** with the **`local`** environment selected.

To try the Postman importer against the same server, use **File → Import → Import from Postman…** and select all three files in [`samples/postman/`](../samples/postman/) (the collection plus the `local` and `production` environment exports).

---

## Available Endpoints

### 1. Health & State Management
| Method | Path | Description |
|---|---|---|
| `GET`, `HEAD` | `/`, `/health`, `/v1/health` | Service status & entity counts |
| `POST` | `/v1/reset` | Resets in-memory orders, inventory, and warehouses back to initial seed data |

### 2. Orders RESTful CRUD (`/v1/orders`)
| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/orders?status=pending&limit=25` | List orders with optional `status`, `customerId`, and `limit` query filters |
| `POST` | `/v1/orders` | Create a new order (`201 Created` + `Location` header) |
| `GET` | `/v1/orders/:orderId` | Get a single order by ID (`ord_1001`, `ord_1002`, `ord_1003`) |
| `PUT` | `/v1/orders/:orderId` | Replace an order completely |
| `PATCH` | `/v1/orders/:orderId` | Partially update order `status`, `notes`, or `items` (JSON or `application/x-www-form-urlencoded`) |
| `DELETE` | `/v1/orders/:orderId` | Delete an order |
| `HEAD` | `/v1/orders`, `/v1/orders/:orderId` | Inspect response headers (`X-Total-Count`, `X-Order-Status`) with an empty body |
| `OPTIONS` | `/v1/orders` | Inspect `Allow` and CORS headers (`204 No Content`) |
| `POST` | `/v1/orders/:orderId/attachments` | Upload a `multipart/form-data` attachment (e.g. `samples/invoice.pdf`) |

### 3. Inventory REST API (`/v1/inventory`)
| Method | Path | Description |
|---|---|---|
| `GET` | `/v1/inventory?warehouseId=WH-EAST-01` | List seeded inventory SKUs (`SKU-100` .. `SKU-400`) |
| `GET` | `/v1/inventory/:sku` | Get a single SKU record |

### 4. GraphQL API (`/graphql` & `sample-api/schema.graphql`)
- Supports both `POST /graphql` and `GET /graphql?query=...`
- Full **`IntrospectionQuery`** support for AwapiLasso's GraphQL Schema Explorer & Visual Query Designer
- Offline SDL file available at [`sample-api/schema.graphql`](./schema.graphql)
- **Queries:** `inventoryItem`, `inventoryItems`, `warehouses`, `warehouse`, `orders`, `order`, `searchCatalog` (Union `SearchResult = InventoryItem | Warehouse | OrderGql`)
- **Mutations:** `adjustInventoryStock`, `createInventoryItem`, `updateOrderStatus`

### 5. OAuth 2.0 & Auth Playground
| Method | Path | Description |
|---|---|---|
| `POST` | `/oauth/token` | Issues signed JWT `access_token` and `refresh_token` for `client_credentials`, `password`, and `refresh_token` grants |
| `GET` | `/v1/auth/bearer` | Verifies `Authorization: Bearer <token>` |
| `GET` | `/v1/auth/basic` | Verifies `Authorization: Basic <base64>` |
| `GET` | `/v1/auth/apikey` | Verifies `X-API-Key` header or `?api_key=` query param |
| `GET` | `/v1/auth/digest` | Full RFC 2617 `401 WWW-Authenticate: Digest` challenge-response flow |
| `ANY` | `/v1/echo` | Echoes method, path, query, headers, cookies, and body |
| `GET` | `/v1/gzip` | Returns gzip-compressed JSON inventory payload |
| `GET` | `/v1/redirect?hops=2` | Multi-hop `302` redirect chain ending at `/v1/echo` |
