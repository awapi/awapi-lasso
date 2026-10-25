# AwapiLasso - Agent Instructions

## Project Overview
AwapiLasso is a fast, lightweight, local-first HTTP, RESTful, and GraphQL API client built for native cross-platform usage across macOS, Windows, and Linux. Collections are stored locally as human-readable, Git-friendly `.awjc` (and `.awj`) YAML files that can be opened directly from the operating system file manager by double-clicking.

## Core Tech Stack
- **Framework:** Electron (Node.js & Chromium)
- **Frontend / UI:** React 19 (Functional components, Hooks)
- **Editor Engine:** Monaco Editor (`@monaco-editor/react`) for request bodies, GraphQL queries/variables, headers, and formatted response inspection
- **Serialization:** YAML (`yaml` package) as the primary `.awjc` / `.awj` collection format, with seamless JSON compatibility
- **Build Tool:** Vite (with `vite-plugin-electron` and `vite-plugin-electron-renderer`)
- **Language:** TypeScript (strict mode)
- **Testing:** Vitest, React Testing Library, JSDOM

## Architecture Constraints & Security
- **Main Process (`src/main/`):**
  - Handles all OS-level operations natively: reading/writing `.awjc` / `.awj` collection files, file watching, native dialogs, application menus, single-instance lock, and OS file associations (`open-file` on macOS, `process.argv` / `second-instance` on Windows/Linux).
  - Executes all outbound HTTP / REST / GraphQL requests and OAuth 2.0 token exchanges natively in Node.js so requests are never blocked by browser CORS policies, can inspect full TLS/socket timing metrics, and support custom certificates, proxies, and redirects.
  - Manages sensitive secrets (passwords, API keys, client secrets, OAuth 2.0 tokens) via Electron `safeStorage` (OS Keychain: macOS Keychain, Windows DPAPI, Linux Secret Service) and/or a gitignored `<collection>.secrets.awjc` local sidecar so plaintext secrets are never written into `.awjc` collection files.
- **Preload Script (`src/preload/`):**
  - Acts as the secure bridge. Exposes safe, strictly typed IPC channels to `window.electronAPI` via `contextBridge`.
- **Renderer Process (`src/renderer/`):**
  - Strict UI layer (`nodeIntegration: false`, `contextIsolation: true`).
  - Cannot use `fs`, `path`, `net`, or `child_process` directly. Must exclusively call `window.electronAPI` for file I/O, secret storage, and HTTP/OAuth execution.
- **Shared Modules (`src/shared/`):**
- Pure TypeScript types, `.awjc` schema definitions, `{{variable}}` interpolation logic, URL/query parameter parsers, GraphQL AST/Query Designer synchronization (`graphqlAstSync.ts`), and declarative assertion evaluators shared between Main, Preload, and Renderer.

## Coding Style & Patterns
- Write modern, functional React components with descriptive names.
- Always use TypeScript with strict typing (`strict: true`). Avoid `any`.
- Keep Inter-Process Communication (IPC) calls lightweight and document both sides in `src/main` and `src/preload`.
- Design pure, dependency-injected modules in `src/main/` and `src/shared/` so all business logic can be unit-tested without launching an Electron binary.

## Agent Customization, Skills & Todos Convention
- Use this root `AGENTS.md` file as the single vendor-neutral source of project instructions across all AI coding agents. Do not create tool-specific instruction files (such as `.github/copilot-instructions.md`).
- Implementation plans and per-phase checklists live in [`todos/`](./todos/README.md) (`01-phase-...` through `07-phase-...`), keeping `docs/` strictly focused on product and user documentation.
- Store project skills in `.agents/skills/<skill-name>/SKILL.md` using the open Agent Skills specification so they remain generic and portable across agents:
  - [electron-ipc](./.agents/skills/electron-ipc/SKILL.md) — Adding or updating Electron IPC channels across Main, Preload, and Renderer.
  - [awjc-collection-format](./.agents/skills/awjc-collection-format/SKILL.md) — Reading, validating, interpolating `{{variables}}`, and saving `.awjc` / `.awj` YAML collections and secrets.
- [graphql-schema-and-designer](./.agents/skills/graphql-schema-and-designer/SKILL.md) — GraphQL schema discovery (introspection + SDL import), visual Query Designer, and two-way GraphQL AST synchronization.
- [testing](./.agents/skills/testing/SKILL.md) — Writing and running Vitest & React Testing Library unit/component tests and typechecking.
- [release](./.agents/skills/release/SKILL.md) — Packaging, cutting, and publishing cross-platform releases (`.dmg`, `.exe`, `.msi`, `.AppImage`, `.deb`).

## 🚨 CRITICAL: Testing Requirements
- **Unit Tests are Mandatory:** Whenever you create a new method, function, or UI component—or modify an existing one—you MUST add and update the corresponding unit tests immediately.
- Use `vitest` for all logic, parser, interpolation, HTTP runner, OAuth 2.0, and state testing.
- Use `@testing-library/react` and `@testing-library/jest-dom` for validating UI renders and user interactions.
- Test files must be placed right alongside their implementation file (e.g., `[filename].test.ts` or `[filename].test.tsx` next to `[filename].ts`).
- Never leave core application logic untested (e.g., `.awjc` YAML serialization, `{{variable}}` resolution, OAuth 2.0 token flows, request building, response assertions).

## 🚨 CRITICAL: Git Operations
- **Never run `git add`, `git commit`, or `git push` automatically.** Do not stage, commit, or push changes unless the user explicitly asks you to do so in their current request.
