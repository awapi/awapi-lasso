# Phase 02 — `.awjc` / `.awj` YAML Engine, `{{Variables}}` & Secrets Store

## Objective
Implement the core `.awjc` / `.awj` single-file collection schema, deterministic YAML (and JSON) serializer, scoped `{{variable}}` interpolation engine, URL/Query/`:path` parameter synchronization, OS Keychain (`safeStorage`) secret management, and file watcher service.

---

## Tasks Checklist

- [x] **T2.1 — `.awjc` Collection Schema & Factory Helpers**
  - Create `src/shared/collectionSchema.ts` + `src/shared/collectionSchema.test.ts`:
    - Define TypeScript interfaces matching `docs/file-format-spec.md`:
      - `AwjcCollection`, `CollectionMetadata`, `CollectionDefaults`
      - `FolderItem`, `RequestItem` (`protocol: 'http' | 'graphql'`)
      - `KeyValueEntry`, `QueryParamEntry`, `PathParamEntry`, `FormDataEntry`
      - `RequestBodyConfig` (`none`, `json`, `yaml`, `xml`, `text`, `form-urlencoded`, `multipart-form`, `binary`)
      - `GraphQLConfig` (`operationName`, `query`, `variables`, `schemaSource`)
      - `AuthConfig` (`inherit`, `none`, `profile`, `bearer`, `basic`, `apikey`, `digest`, `awsv4`, `oauth2`) & `OAuth2Config`
      - `EnvironmentConfig`, `VariableEntry` (`secret?: boolean`)
      - `CaptureRule` & `AssertionRule`
    - Implement schema validation and factory helpers (`createEmptyCollection`, `createDefaultHttpRequest`, `createDefaultGraphQLRequest`, `createDefaultFolder`, `createDefaultEnvironment`).

- [x] **T2.2 — Deterministic YAML / JSON Serializer & Secret Stripper**
  - Create `src/shared/awjcSerializer.ts` + `src/shared/awjcSerializer.test.ts`:
    - `parseCollectionFile(rawContent: string)`: Parses YAML 1.2 or JSON into a validated `AwjcCollection`. If any `secret: true` entry contains a plaintext value on load, extract it so `secretStore` can migrate it out of plaintext.
    - `serializeCollectionToYaml(collection: AwjcCollection)`: Serializes to clean 2-space YAML with deterministic key ordering while stripping plaintext `value` fields from any variable/credential marked `secret: true`.
    - `serializeCollectionToJson(collection: AwjcCollection)`: Optional JSON export with the same secret-stripping guarantee.

- [x] **T2.3 — Scoped `{{Variable}}` Interpolation & Dynamic Variables Engine**
  - Create `src/shared/interpolation.ts` + `src/shared/interpolation.test.ts`:
    - Resolve variables in precedence order (lowest → highest):
      1. Global Variables
      2. Collection Variables
      3. Active Environment Variables (merged with secrets hydrated from `secretStore`)
      4. Ancestor Folder Variables (outermost → innermost)
      5. Runtime Captured Variables
      6. Built-in Dynamic Variables (`{{$uuid}}`, `{{$timestamp}}`, `{{$timestampMs}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`, `{{$randomEmail}}`, `{{$randomString}}`)
    - Support nested variable references (e.g., `baseUrl: "{{protocol}}://{{host}}:{{port}}"`) with cycle detection and max depth (`10`).
    - Implement `inspectVariablesInText(text, context)` returning token positions, resolved value, source scope, `isSecret`, and `isResolved` for UI highlighting and hover tooltips.

- [x] **T2.4 — Bi-Directional URL, Query Params & `:path` Variables Sync**
  - Create `src/shared/urlParams.ts` + `src/shared/urlParams.test.ts`:
    - Parse query parameters from URL strings while preserving `{{variable}}` tokens unescaped and keeping disabled (`enabled: false`) table rows intact.
    - Extract `:paramName` and `{paramName}` path parameters from URL paths and synchronize with `pathParams`.
    - Build the final resolved request URL by interpolating `{{variables}}`, substituting `:pathParams`, and appending enabled `queryParams`.

- [x] **T2.5 — OS Keychain (`safeStorage`) & Local Sidecar Secret Store**
  - Create `src/main/secretStore.ts` + `src/main/secretStore.test.ts`:
    - Store and retrieve secret values encrypted with Electron's `safeStorage` (macOS Keychain, Windows DPAPI, Linux Secret Service) keyed by `(collectionId, scopeId, variableKey)`.
    - Support optional gitignored `<collection-file>.secrets.awjc` local sidecar override file and a helper to add `*.secrets.awjc` to `.gitignore`.

- [x] **T2.6 — Collection File Service, External Watcher & Sample Collection**
  - Create `src/main/collectionFileService.ts` + `src/main/collectionFileService.test.ts`:
    - Read/write `.awjc` and `.awj` files, hydrate secrets on load, strip secrets on save, track `Open Recent` collections, and watch open files on disk for external changes.
  - Create sample collection `samples/orders-and-inventory.awjc` showcasing REST, OAuth 2.0 (`password` & `client_credentials`), Environments, and GraphQL.
  - Wire IPC channels (`collection:openDialog`, `collection:openPath`, `collection:save`, `collection:saveAs`, `secrets:get`, `secrets:set`, `secrets:delete`) in Main and Preload.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
```

---

## Agent Prompt for Phase 02
```markdown
Execute Phase 02 (`todos/02-phase-awjc-yaml-and-secrets.md`) following `AGENTS.md`, `docs/file-format-spec.md`, and `.agents/skills/awjc-collection-format/SKILL.md`. Write comprehensive unit tests (`*.test.ts`) for every module, check off completed tasks in `todos/02-phase-awjc-yaml-and-secrets.md`, and verify `pnpm run typecheck && pnpm run test` pass.
```
