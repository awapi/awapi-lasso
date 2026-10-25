# Phase 06 — Import/Export (`curl`, OpenAPI), Code Generator & Collection Runner

## Objective
Add developer productivity workflows: paste-to-import `curl` commands, OpenAPI 3.x / Swagger 2.0 collection import, multi-language request code snippet generation, sequential Collection/Folder Runner, and local request execution history.

---

## Tasks Checklist

- [ ] **T6.1 — Paste-to-Import `curl` Command Parser**
  - Create `src/shared/curlParser.ts` + `src/shared/curlParser.test.ts`:
    - Parse `curl` commands (single-line and multi-line with `\` or `^` continuations), extracting HTTP method (`-X` / `--request`), URL & query params, headers (`-H` / `--header`), basic auth (`-u` / `--user`), JSON/raw body (`-d` / `--data` / `--data-raw` / `--data-binary`), URL-encoded body (`--data-urlencode`), and multipart fields (`-F` / `--form`).
  - Detect pasted `curl ...` strings directly in `RequestUrlBar.tsx` (as well as via `File -> Import cURL…`) to populate the request immediately.

- [ ] **T6.2 — OpenAPI 3.x / Swagger 2.0 Collection Importer**
  - Create `src/shared/openapiImporter.ts` + `src/shared/openapiImporter.test.ts`:
    - Import `.yaml` or `.json` OpenAPI 3.0/3.1 and Swagger 2.0 specifications and generate a clean `AwjcCollection` with tag-based folders, path/query/header parameters, sample JSON request bodies, security schemes (`bearer`, `basic`, `apikey`, `oauth2`), and `{{baseUrl}}` environment variables.

- [ ] **T6.3 — Multi-Language Code Snippet Generator**
  - Create `src/shared/codeGenerator.ts` + `src/shared/codeGenerator.test.ts`:
    - Generate ready-to-copy snippets for any HTTP or GraphQL request (with a toggle to either preserve `{{variables}}` or inline resolved values):
      - `cURL` (Bash & PowerShell)
      - JavaScript / TypeScript (`fetch`, `axios`)
      - Python (`requests`, `httpx`)
      - Go (`net/http`)
      - C# (`HttpClient`)
      - Rust (`reqwest`)
  - Create `src/renderer/src/components/CodeSnippetModal.tsx` + `CodeSnippetModal.test.tsx`.

- [ ] **T6.4 — Sequential Collection / Folder Runner & Local History**
  - Create `src/renderer/src/components/CollectionRunnerModal.tsx` + `CollectionRunnerModal.test.tsx`:
    - Select a Collection or Folder and target Environment, configure delay (`ms`) between requests and stop-on-failure option, execute requests sequentially (applying post-response `captures` between steps), and display an aggregate assertion Pass/Fail report with JSON export.
  - Create `src/renderer/src/components/RequestHistoryDrawer.tsx` + `RequestHistoryDrawer.test.tsx`:
    - Local history log of executed requests with status badge, timestamp, duration, and one-click **Restore to Tab** or **Save to Collection**.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

---

## Agent Prompt for Phase 06
```markdown
Execute Phase 06 (`todos/06-phase-import-codegen-and-runner.md`) following `AGENTS.md` and `docs/requirements.md` (FR-10, FR-11). Add co-located unit and component tests (`*.test.ts` / `*.test.tsx`), check off completed tasks in `todos/06-phase-import-codegen-and-runner.md`, and verify `pnpm run typecheck && pnpm run test && pnpm run build` pass.
```
