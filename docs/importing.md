# Importing Collections

AwapiLasso can turn collections from **Postman**, **Bruno**, **OpenAPI / Swagger**, and **cURL** into a `.awjc` collection. Open the importers from **File → Import** or from the **Import** button in the toolbar.

- [Postman](#postman)
- [Bruno](#bruno)
- [OpenAPI / Swagger](#openapi--swagger)
- [cURL](#curl)
- [After importing](#after-importing)
- [Secrets](#secrets)

---

## Postman

Postman keeps each part of your workspace in its own export file. AwapiLasso imports them all in one go: select the collection file **and** any environment or globals files together in the file dialog (Cmd/Ctrl-click or Shift-click to pick several).

| Postman export | File name Postman suggests | Becomes in AwapiLasso | Required |
|---|---|---|---|
| Collection (v2.1 or v2.0) | `My API.postman_collection.json` | The collection: folders, requests, collection variables, collection auth | **Yes, exactly one** |
| Environment | `Staging.postman_environment.json` | One environment per file, named as in Postman. The first one becomes active. | No, any number |
| Globals | `My Workspace.postman_globals.json` | Collection variables, added only for names the collection doesn't already define (globals have the lowest precedence in Postman too) | No |

### Exporting from Postman

1. **Collection:** in the sidebar, open the collection's **⋯** menu → **Export** → choose **Collection v2.1** (recommended) → **Export**.
2. **Environments:** open **Environments**, then for each environment you need, open its **⋯** menu → **Export**.
3. **Globals (optional):** open **Environments** → **Globals** → **Export**.

Then in AwapiLasso choose **File → Import → Import from Postman…** and select all the files at once.

> Postman Collection **v1** files are not supported. Export the collection again as v2.1.
>
> Postman's **data dump** (Settings → Data → Export data) is a ZIP of many collections. Unzip it and import one collection at a time.

### What carries over

| Postman | AwapiLasso |
|---|---|
| Folders (nested) and requests, in the same order | Folders and requests |
| Folder and collection descriptions, request descriptions | Descriptions |
| Collection variables, folder variables | Collection and folder variables |
| Environment values, including **disabled** values and `secret`-type values | Environment variables (secret values are kept in the OS Keychain, see [Secrets](#secrets)) |
| Headers, query parameters, and path variables (`:id`), including disabled rows | Headers, query and path parameters |
| Body: raw (JSON, XML, HTML, text), `x-www-form-urlencoded`, `form-data` (text and file fields), binary file, GraphQL | Body: `json`, `xml`, `html`, `text`, `form-urlencoded`, `multipart-form`, `binary`, or a GraphQL request |
| Auth at collection, folder, and request level: No Auth, Inherit, Basic, Bearer, API Key, Digest, AWS Signature, OAuth 2.0 | The same auth type at the same level |
| OAuth 2.0 grants: Authorization Code, Authorization Code (With PKCE), Client Credentials, Password Credentials | `authorization_code`, `authorization_code_pkce`, `client_credentials`, `password` |
| `{{variables}}` | Same syntax, nothing to change |
| `{{$guid}}`, `{{$randomUUID}}` | `{{$uuid}}` |
| `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}` | Same name |

**Test scripts.** AwapiLasso doesn't run JavaScript, but the most common Postman test lines are converted into declarative [captures and assertions](features.md#5-response-inspector-captures--assertions):

| In a Postman test script | Becomes |
|---|---|
| `pm.response.to.have.status(200)` or `pm.expect(pm.response.code).to.eql(200)` | Assertion: status equals 200 |
| `pm.environment.set("token", pm.response.json().data.token)` | Capture `token` from `$.data.token` into the environment |
| `const json = pm.response.json(); pm.collectionVariables.set("id", json.items[0].id)` | Capture `id` from `$.items[0].id` into collection variables |
| `pm.variables.set(...)` / `pm.globals.set(...)` | Capture into runtime / collection variables |
| `pm.environment.set("etag", pm.response.headers.get("ETag"))` | Capture `etag` from the `ETag` response header |

`pm.test("…", function () { … })` wrappers and comments around these lines are fine. If a script contains anything else, the converted parts are kept and the import summary tells you which requests to review.

### What doesn't carry over

These are listed in the summary shown after import, with the affected requests:

- **Pre-request scripts**, collection-level and folder-level scripts, and test-script logic beyond the patterns above.
- **Auth types** with no AwapiLasso equivalent (NTLM, Hawk, Akamai EdgeGrid, JWT Bearer, ASAP). These requests are set to No Auth.
- The **OAuth 2.0 Implicit** grant, which becomes Authorization Code + PKCE.
- OAuth 2.0 tokens sent as **query parameters**, which are sent as a header instead.
- **Random-data variables** such as `{{$randomFirstName}}` or `{{$randomCity}}`. They are left as-is and won't resolve.
- Only the first file of a **multi-file form field** is kept.

Not imported and not reported: saved example responses, cookies, certificates, proxy settings, and Postman Flows or monitors.

---

## Bruno

Bruno stores a collection as a **folder** on disk. You can import that folder directly, or import a JSON file exported from Bruno.

### Option 1: import the collection folder (recommended)

Choose **File → Import → Import from Bruno…** and select the **`bruno.json`** file at the top of the collection folder. AwapiLasso reads the whole folder:

```text
my-api/
├── bruno.json                 ← select this file
├── collection.bru             collection headers, auth, variables, docs
├── environments/
│   ├── local.bru              one environment per file (name from the file name)
│   └── production.bru
├── Users/
│   ├── folder.bru             folder name, order, headers, auth, variables
│   ├── List users.bru         one request per .bru file
│   └── Get user.bru
└── Health.bru
```

Folders listed in the `ignore` setting of `bruno.json` are skipped, and so are `node_modules` and `.git`. The `.env` file is never read.

### Option 2: import a Bruno JSON export

In Bruno, open the collection's **⋯** menu → **Share** (called **Export** in older versions) → **Bruno Collection**, then select the exported `.json` file in AwapiLasso's **Import from Bruno…** dialog.

### What carries over

| Bruno | AwapiLasso |
|---|---|
| Folders (nested) and requests, in Bruno's order (`seq`) | Folders and requests |
| `collection.bru` headers, auth, `vars:pre-request`, `docs` | Collection default headers and auth, collection variables, description |
| `folder.bru` headers, auth, `vars:pre-request`, `docs` | Folder headers, auth, variables, description |
| `environments/*.bru` `vars`, including disabled (`~`) entries | Environment variables. The first one, alphabetically, becomes active. |
| `vars:secret` | Secret environment variables, **with empty values**, see below |
| `params:query` and `params:path`, headers, including disabled entries | Query and path parameters, headers |
| Body: JSON, XML, text, form-urlencoded, multipart form (text and `@file(...)` fields), file, GraphQL (query and variables) | Body: `json`, `xml`, `text`, `form-urlencoded`, `multipart-form`, `binary`, or a GraphQL request |
| Auth: inherit, none, Basic, Bearer, API Key (header or query), Digest, AWS Sig v4, OAuth 2.0 (Authorization Code with or without PKCE, Client Credentials, Password) | The same auth type at the same level |
| `docs` | Request description |

**Assertions, variables, and scripts.**

| In Bruno | Becomes |
|---|---|
| `assert { res.status: eq 200 }` | Assertion: status equals 200 |
| `assert { res.status: in [200, 201] }`, `res.body.id: isDefined`, `res.responseTime: lt 500`, `res.headers['content-type']: contains json` | The matching assertion. Operators `eq`, `neq`, `gt`, `lt`, `in`, `contains`, `notContains`, `matches`, `isEmpty`, `isNotEmpty`, `isDefined`, `isUndefined`, and `isArray` are supported. |
| `vars:post-response { token: res.body.token }` | Capture `token` from `$.token` (runtime scope, like Bruno) |
| `res.headers.location`, `res("data.items[0].id")`, `res.status` in post-response vars | Header, JSONPath, or status capture |
| `bru.setEnvVar("id", res.body.data.id)` in a post-response script | Capture `id` from `$.data.id` into the environment |
| `bru.setVar(...)` / `bru.setGlobalEnvVar(...)` | Capture into runtime / collection variables |
| `expect(res.status).to.equal(200)` in tests | Assertion: status equals 200 |

### What doesn't carry over

Listed in the summary shown after import:

- **Secret values.** Bruno never writes secret values into its files, so `vars:secret` entries arrive empty. Fill them in under **Environments** after importing. They are stored in the OS Keychain.
- **`{{process.env.NAME}}`** references to Bruno's `.env` file. Define these as variables instead.
- **Request-level variables** (`vars:pre-request` on a single request). AwapiLasso has variables on collections, folders, and environments only.
- **Pre-request scripts**, collection and folder scripts, and test or post-response script logic beyond the patterns above.
- **Assertion operators** with no equivalent: `gte`, `lte`, `notIn`, `length`, `startsWith`, `endsWith`, `between`, `isNull`, `isTruthy`, `isFalsy`, `isJson`, `isNumber`, `isString`, `isBoolean`, `notMatches`.
- **Auth types** with no equivalent (NTLM, WSSE, …), which become No Auth, and AWS **profile names**. Set the access keys instead.
- **File paths** of form fields and file bodies stay relative to the Bruno collection folder. Check them after saving.
- **SPARQL** bodies are imported as plain text.

---

## OpenAPI / Swagger

**File → Import → Import from OpenAPI / Swagger…** reads one OpenAPI 3.x or Swagger 2.0 file (YAML or JSON). Each operation becomes a request with sample parameters and bodies generated from the schema, grouped into one folder per tag. `servers` become environments with a `baseUrl` variable, and security schemes become auth profiles.

## cURL

**File → Import → Import from cURL…** opens a box to paste a `curl` command (for example from your browser's **Copy as cURL**). It becomes a single request.

---

## After importing

- The imported collection opens in the sidebar as **unsaved**. Nothing is written to disk until you save.
- If anything couldn't be converted exactly, a summary lists each issue once with the affected requests (for example *"Pre-request scripts were not imported (3: Login, Refresh, Logout)"*). The import still completes.
- **Save** (Cmd/Ctrl+S) writes the collection next to what you imported: `My API.postman_collection.json` becomes `My API.postman_collection.awjc`, and the Bruno folder `my-api/` becomes `my-api.awjc`. Use **Save As…** to choose another name or location.
- Run a few requests, or the [Collection Runner](features.md), to confirm that environments, auth, and captures behave as they did before.

## Secrets

Imports never put secrets into the `.awjc` file. When you save, these values are moved into the OS Keychain (macOS Keychain, Windows DPAPI, or Linux Secret Service) and only a `secret: true` marker stays in the file:

- Postman variables of type **secret**, and Bruno `vars:secret` entries.
- Credentials typed directly into auth settings: Basic/Digest passwords, Bearer tokens, API key values, OAuth 2.0 client secrets and passwords, AWS secret keys.
- Variables and headers with credential-like names (`token`, `password`, `apiKey`, `Authorization`, …) that hold a literal value.

Values that are only `{{variable}}` references, and plain URLs, are left as they are. You can mark or unmark a value as secret afterwards with the **Mark as Secret** toggle next to it in the headers, params, and environment tables.
