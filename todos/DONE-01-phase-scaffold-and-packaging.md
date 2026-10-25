# Phase 01 — Project Scaffold, Build Pipeline & Cross-Platform Packaging

## Objective
Bootstrap the **AwapiLasso** Electron + React 19 + TypeScript + Monaco Editor + Vite + Vitest project, set up the cross-platform `justfile` and GitHub Actions CI/Release pipelines (modeled after `../awapi-editor`), and register `.awjc` / `.awj` OS file associations so double-clicking a collection file opens AwapiLasso on **macOS, Windows, and Linux**.

---

## Tasks Checklist

- [x] **T1.1 — Initialize `package.json`, TypeScript, Vite & `.gitignore`**
  - Create `.gitignore` (modeled after `../awapi-editor/.gitignore`, including `local/`, `*.secrets.awjc`, `.env.secret*`, `dist/`, `release/`).
  - Create `package.json` with:
    - Core deps: `react`, `react-dom`, `@monaco-editor/react`, `monaco-editor`, `lucide-react`, `yaml`, `graphql`
    - Dev/build deps: `electron`, `electron-builder`, `vite`, `vite-plugin-electron`, `vite-plugin-electron-renderer`, `@vitejs/plugin-react`, `typescript`, `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/dom`, `cross-env`, `sharp`, `png2icons`
  - Configure `build` in `package.json` (`appId: com.awapi.awapilasso`, `productName: AwapiLasso`) for:
    - **macOS:** `.dmg` (`identity: "-"`, `hardenedRuntime: false`, `gatekeeperAssess: false`)
    - **Windows:** `nsis` (`.exe`) and `msi` (`.msi`)
    - **Linux:** `AppImage` and `deb`
    - **`fileAssociations`:** `.awjc` and `.awj` (`AwapiLasso Collection`)
  - Create `tsconfig.json` (`strict: true`) and `vite.config.ts`.

- [x] **T1.2 — Cross-Platform `justfile`, Icons & macOS Installer Script**
  - Create `justfile` with `[unix]` (bash) and `[windows]` (PowerShell) recipes: `default`, `install`, `dev`, `test`, `test-once`, `typecheck`, `build`, `package`, `clean`, `release`, `publish`.
  - Create `build/icon.svg` and `scripts/generate-icons.js` to generate `icon.icns`, `icon.ico`, and PNG sizes (`32x32` through `512x512`).
  - Create `scripts/install-macos.sh` to download the latest `AwapiLasso` DMG from `awapi/awapi-lasso`, copy `AwapiLasso.app` to `/Applications`, and run `xattr -cr`.

- [x] **T1.3 — GitHub Actions CI & Release Workflows**
  - Create `.github/workflows/ci.yml`:
    - `build_and_test` job on `ubuntu-latest` and `windows-latest` (`pnpm install --frozen-lockfile`, `pnpm audit --audit-level=high`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build`).
    - `justfile` job on `ubuntu-latest`, `macos-latest`, and `windows-latest` verifying `just` recipes across bash and PowerShell.
  - Create `.github/workflows/release.yml`:
    - Triggered on `v*` tags and `workflow_dispatch` across `macos-latest`, `ubuntu-latest`, and `windows-latest` to build and upload `.dmg`, `.exe`, `.msi`, `.AppImage`, and `.deb` installers to a draft GitHub Release.

- [x] **T1.4 — OS File Association, Windows Context Menu & CLI Helpers (`src/main/`)**
  - `src/main/osFileAssociation.ts` + `src/main/osFileAssociation.test.ts`:
    - Extract `.awjc` and `.awj` file paths passed via `process.argv`, `second-instance` command line, and macOS `open-file` events.
    - Queue cold-start file paths until `mainWindow` is ready, then deliver them over IPC (`collection:openedFromOs`).
  - `src/main/contextMenu.ts` + `src/main/contextMenu.test.ts`:
    - Register/unregister `"Open with AwapiLasso"` in Windows Explorer (`HKCU\Software\Classes\*\shell\AwapiLasso`).
  - `src/main/cliCommand.ts` + `src/main/cliCommand.test.ts`:
    - Install/remove the `awlasso` CLI launcher symlink/shim so users can run `awlasso my-api.awjc` from any terminal.
  - `src/main/session.ts` + `src/main/session.test.ts`:
    - Load/save user preferences (theme, SSL defaults, timeout) and session state.
  - `src/main/updater.ts` + `src/main/updater.test.ts`:
    - Check `https://api.github.com/repos/awapi/awapi-lasso/releases/latest` for updates.

- [x] **T1.5 — Minimal Main Process, Preload Bridge & Renderer Shell**
  - Create `src/main/main.ts` with single-instance lock (`app.requestSingleInstanceLock()`), native application menu, and IPC wiring.
  - Create `src/preload/index.ts` and `src/preload/globals.d.ts` exposing `window.electronAPI`.
  - Create `src/renderer/index.html`, `src/renderer/src/main.tsx`, and `src/renderer/src/App.tsx` + `src/renderer/src/App.test.tsx`.

---

## Verification Gate
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

---

## Agent Prompt for Phase 01
```markdown
Execute Phase 01 (`todos/01-phase-scaffold-and-packaging.md`) following `AGENTS.md`, `docs/requirements.md`, and `docs/release-process.md`. Reference `../awapi-editor` for Electron + React 19 + Vite + Vitest + electron-builder configuration, `justfile`, and GitHub Actions workflows. Check off each task in `todos/01-phase-scaffold-and-packaging.md` as you complete it and ensure `pnpm run typecheck`, `pnpm run test`, and `pnpm run build` pass.
```
