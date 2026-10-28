# Phase 10 — Export to Postman (Future Phase)

## Objective
Let users hand an AwapiLasso collection, folder, or single request to someone who uses Postman. A new **Export to Postman…** entry in the sidebar context menus (collection, folder, request) writes a **Postman Collection v2.1** JSON file, plus optional **Postman environment** files, that import cleanly into Postman. It is the reverse of the Postman importer (`src/shared/postmanImporter.ts`). Plaintext secrets must never reach the exported files.

---

## Tasks Checklist

- [ ] **T10.1 — Pure Postman Exporter (`src/shared/postmanExporter.ts`)**
  - `exportPostmanCollection(collection, { itemId? })` returns a Postman v2.1 document (`info.schema` = `https://schema.getpostman.com/json/collection/v2.1.0/collection.json`) for the whole collection, or for one folder or request when `itemId` is given.
  - Map the tree: folders become `item` groups with `auth`, `variable`, and `description`; requests become `request` objects with `method`, `header` (including `disabled`), `url` (`raw`, `host`, `path`, `query`, and `variable` for `:path` params), `auth`, and `description`.
  - Map bodies: `json` / `xml` / `html` / `text` / `yaml` become `raw` with `options.raw.language`; `form-urlencoded` becomes `urlencoded`; `multipart-form` becomes `formdata` (`type: file` with `src`); `binary` becomes `file`; GraphQL requests become `body.mode: graphql`.
  - Map auth (v2.1 `[{ key, value, type }]` lists): `none` becomes `noauth`. `inherit` omits `auth`, so the request inherits. `basic`, `bearer`, `apikey` (`in`), `digest`, `awsv4`, and `oauth2` map back to Postman's names: `grant_type`, `accessTokenUrl`, `authUrl`, `clientId`, `client_authentication`, `challengeAlgorithm`. Auth `profile` references are resolved to the profile's config.
  - Collection `defaults.auth` and `defaults.headers` map to collection-level `auth`, and to collection headers by pushing them down to requests, since Postman has no collection headers. Collection `variables` map to `variable`.
  - Map dynamic variables back where names differ: `{{$uuid}}` becomes `{{$guid}}`. Other built-ins keep their names.
  - **Captures & assertions → test scripts:** generate a `test` event with `pm.test(...)` blocks for each assertion (`status` / `responseTime` / `header` / `jsonpath` with each operator). Turn each capture into `pm.environment.set` / `pm.collectionVariables.set` / `pm.variables.set`, by scope, from `pm.response.json()` paths, `pm.response.headers.get(...)`, or `pm.response.code`. Disabled rules are exported commented out.
  - Return `{ document, warnings }`. Warnings cover anything without a Postman equivalent, such as JSONPath filter or wildcard expressions in captures, or settings like `timeoutMs`, `verifySsl`, and `followRedirects`.

- [ ] **T10.2 — Secret Handling (never export plaintext secrets)**
  - Values with `secret: true`, `clientSecretIsSecret`, or `passwordIsSecret`, plus keychain-only values, are exported **empty**, never resolved from `secretStore`. Variables keep `type: "secret"` so Postman masks them once the user fills them in.
  - Literal credentials that are not flagged `secret` (detected with `looksSecret` from `src/shared/importerUtils.ts`) are exported as-is, but the export dialog warns about them first and offers to blank them.
  - Tests prove that no secret from the collection, or from the injected secret store, appears in the exported JSON.

- [ ] **T10.3 — Environment Export (`exportPostmanEnvironment(environment)`)**
  - Each `EnvironmentConfig` becomes a `*.postman_environment.json` file (`_postman_variable_scope: "environment"`, `values[]` with `type: default | secret`, `enabled`), with secret values blanked as in T10.2.
  - The export dialog offers "Also export environments" (checked by default for whole-collection exports).

- [ ] **T10.4 — Main-Process Save Flow & IPC (`collection:exportPostmanDialog`)**
  - The renderer sends the in-memory collection (including unsaved edits) plus the optional `itemId`. Main runs the exporter, shows a save dialog (default name `<collection-or-item>.postman_collection.json`, last-open directory), and writes the collection plus any selected environment files beside it.
  - Show exporter warnings in a native message box after a successful export, the same way import notes are shown.
  - Expose `exportPostmanWithDialog(options)` in `src/preload/index.ts` and `src/preload/globals.d.ts`, documented on both sides.

- [ ] **T10.5 — Sidebar Context Menus (`src/renderer/src/components/CollectionSidebar.tsx`)**
  - Add **Export to Postman…** to the collection menu (`col-menu-export-postman-<id>`), folder menu, and request menu, plus the right-click (`onContextMenu`) variants.
  - Wire it through `App.tsx` with an `onExportToPostman(collectionPath, itemId?)` callback, and add component and App tests.
  - Leave room in the menu for a later **Export to Bruno…** entry, which reverses `src/shared/brunoImporter.ts`.

- [ ] **T10.6 — Round-Trip & Fixture Tests**
  - Export `samples/orders-and-inventory.awjc`, re-import the result with `importPostmanCollection`, and assert that requests, folders, bodies, auth, variables, assertions, and captures survive the round trip.
  - Import `samples/postman/*.json`, export them again, and compare the structure with the originals, allowing documented differences such as unsupported scripts.
  - Validate the exported JSON against the published Postman v2.1 schema (a dev-only test dependency or a vendored copy of the schema).

- [ ] **T10.7 — Docs**
  - Document the export, including what doesn't carry over and how secrets are handled, in `docs/features.md`.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```
