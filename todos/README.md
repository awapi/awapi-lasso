# AwapiLasso — Implementation Todos Index

This `todos/` folder tracks the implementation work for **AwapiLasso**, organized into focused, self-contained phase files so each phase can be planned, executed, and verified independently.

---

## 📂 Phase Todo Files

| Phase | File | Scope | Status |
|---|---|---|---|
| **Phase 01** | [DONE-01-phase-scaffold-and-packaging.md](./DONE-01-phase-scaffold-and-packaging.md) | Electron + React 19 + TS + Vite + Vitest scaffold, `justfile`, GitHub Actions CI/Release, `.awjc` / `.awj` OS file associations, Windows context menu, `awlasso` CLI | ✅ Completed |
| **Phase 02** | [DONE-02-phase-awjc-yaml-and-secrets.md](./DONE-02-phase-awjc-yaml-and-secrets.md) | `.awjc` / `.awj` YAML & JSON schema/serializer, `{{variable}}` & dynamic variable interpolation, URL/Query/`:path` sync, OS Keychain (`safeStorage`) & local secrets sidecar | ✅ Completed |
| **Phase 03** | [DONE-03-phase-http-and-oauth2-engine.md](./DONE-03-phase-http-and-oauth2-engine.md) | Node.js Main-process HTTP/HTTPS engine, Auth inheritance (`Bearer`, `Basic`, `API Key`, `Digest`, `AWSv4`), **OAuth 2.0 Token Manager** (`password`, `client_credentials`, `authorization_code` + PKCE, `refresh_token`), JWT decoder, response captures & assertions | ✅ Completed |
| **Phase 04** | [DONE-04-phase-core-desktop-ui.md](./DONE-04-phase-core-desktop-ui.md) | Multi-collection sidebar, multi-tab request bar, URL bar with `{{variable}}` hover preview, Params/Headers/Auth/OAuth2/Body/Captures/Assertions tabs, Environment & Secrets modal, Response Inspector & Monaco Diff viewer | ✅ Completed |
| **Phase 05** | [DONE-05-phase-graphql-designer-and-schema.md](./DONE-05-phase-graphql-designer-and-schema.md) | GraphQL Schema Discovery (`IntrospectionQuery` + offline `.graphql` SDL / `.json` import), interactive **Visual Query Designer**, two-way AST sync (`Query Designer` ↔ `Monaco Editor`), and Schema Explorer | ✅ Completed |
| **Phase 06** | [06-phase-import-codegen-and-runner.md](./06-phase-import-codegen-and-runner.md) | Paste-to-import `curl`, OpenAPI 3.x / Swagger 2.0 importer, multi-language code snippet generator, Collection/Folder Runner, and local request history | ⏳ Pending |
| **Phase 07** | [07-phase-git-integration.md](./07-phase-git-integration.md) | Built-in Git status indicator, visual YAML diff for `.awjc` files, branch switching, commit, and push/pull (enabled by local `.awjc` storage) | ⏳ Pending |
| **Phase 08** | [08-phase-mcp-server-analyzer.md](./08-phase-mcp-server-analyzer.md) | **MCP Server Analyzer & Inspector** — Streamable HTTP & HTTP+SSE (plus optional `stdio`) JSON-RPC 2.0 client, capability/tool/resource/prompt discovery, LLM token footprint & spec analyzer, and schema-driven interactive Tool Runner | ⏳ Pending |

---

## 🏗️ Target Directory Structure

```text
awapi-lasso/
├── .agents/skills/                  # Portable AI agent skills
├── .github/workflows/
│   ├── ci.yml                       # Multi-OS CI (Ubuntu + Windows + macOS justfile checks)
│   └── release.yml                  # Tag-triggered multi-OS installer builds (.dmg, .exe, .msi, .AppImage, .deb)
├── build/                           # App icons (icon.svg, icon.icns, icon.ico, icon-*.png)
├── docs/                            # Product docs (features.md, requirements.md, file-format-spec.md, release-process.md)
├── samples/                         # Example .awjc collections (REST, OAuth2, GraphQL)
├── scripts/
│   ├── generate-icons.js            # Generates .icns, .ico, and PNG sizes from build/icon.svg
│   └── install-macos.sh             # One-line macOS DMG installer & Gatekeeper xattr cleaner
├── todos/                           # Modular per-phase implementation checklists & prompts
├── src/
│   ├── shared/                      # Pure TypeScript models & engines (shared by Main, Preload, Renderer)
│   ├── main/                        # Electron Main Process (Node.js native OS, Keychain & HTTP/OAuth2 layer)
│   ├── preload/                     # Secure Context Bridge (window.electronAPI)
│   └── renderer/                    # React 19 + Monaco Editor UI Layer (nodeIntegration: false)
├── justfile                         # Cross-platform task runner (bash on Unix, PowerShell on Windows)
├── package.json                     # Dependencies & electron-builder config (.awjc / .awj fileAssociations)
├── tsconfig.json
└── vite.config.ts
```

---

## 🚨 Global Engineering Rules (Applies to Every Phase)
1. **Strict Process Isolation:** All filesystem I/O, OS Keychain (`safeStorage`), and outbound HTTP/GraphQL/OAuth2 requests run in `src/main/`. The renderer (`src/renderer/`) has `nodeIntegration: false` and communicates strictly via `window.electronAPI`.
2. **Co-Located Mandatory Unit Tests:** Every `.ts` or `.tsx` file must have a matching `.test.ts` or `.test.tsx` file right next to it.
3. **Never Leak Plaintext Secrets:** Variables or auth fields with `secret: true` (and cached OAuth 2.0 tokens) must never be serialized in plaintext inside `.awjc` / `.awj` files.
4. **No Automatic Git Commits:** Never run `git add`, `git commit`, or `git push` unless explicitly requested by the user.
