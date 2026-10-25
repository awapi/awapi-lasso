# AwapiLasso

[![CI](https://github.com/awapi/awapi-lasso/actions/workflows/ci.yml/badge.svg)](https://github.com/awapi/awapi-lasso/actions/workflows/ci.yml)
[![Release Builds](https://github.com/awapi/awapi-lasso/actions/workflows/release.yml/badge.svg)](https://github.com/awapi/awapi-lasso/actions/workflows/release.yml)

**AwapiLasso** is a fast, lightweight, local-first HTTP, RESTful, and GraphQL API client built for native cross-platform execution across **macOS, Windows, and Linux**.

---

## ✨ Key Highlights

- **Cross-Platform Native App:** Runs seamlessly on **Windows** (`.exe` NSIS & `.msi`), **macOS** (`.dmg` for Apple Silicon & Intel), and **Linux** (`.AppImage` & `.deb`).
- **Universal API Support:** First-class support for **RESTful APIs**, arbitrary **HTTP/HTTPS** requests, and **GraphQL** (including automatic **Schema Discovery**, an interactive **Visual Query Designer** with two-way AST sync, **Schema Explorer**, and split Query/Variables editors).
- **Single-File YAML Collections (`.awjc` & `.awj`):** Save each collection—including nested folders, requests, auth profiles, and environments—locally in a clean, human-readable `.awjc` YAML file (with full JSON compatibility). Ready for local file sharing today and seamless Git workflows tomorrow.
- **Click-to-Open OS Integration:** Double-click any `.awjc` or `.awj` collection file in macOS Finder, Windows Explorer (or via the right-click *"Open with AwapiLasso"* context menu), or Linux file manager to open it directly in AwapiLasso.
- **Environments, `{{Variables}}` & Secrets:** Pass `{{baseUrl}}`, `{{token}}`, `{{userId}}`, and dynamic variables (`{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`) into URLs, query/path parameters, headers, auth settings, request bodies, and GraphQL queries. Secret variables (passwords, API keys, client secrets, tokens) are protected in the OS Keychain (`safeStorage`) or a gitignored local sidecar—never leaked in plaintext inside `.awjc` files.
- **Built-in OAuth 2.0 Token Manager:** Acquire, inspect (with decoded JWT preview), cache, and auto-refresh tokens from OAuth 2.0 endpoints using **Password (`password`)**, **Client Credentials (`client_credentials`)**, **Authorization Code (`authorization_code` + PKCE)**, and **Refresh Token (`refresh_token`)** flows.

---

## 🛠️ Local Development, Packaging & Releasing on GitHub

### 1. Local Development & Testing
```bash
# Install dependencies
just install        # or: pnpm install

# Start the app in dev mode + local Sample REST/GraphQL/OAuth2 API on port 8080
just dev            # or: pnpm run dev

# Run strict TypeScript check and Vitest suite
just typecheck      # or: pnpm run typecheck
just test-once      # or: pnpm run test
```

### 2. Generate Local Installation Packages (Current OS)
To build the production bundle and package the native installer locally into `release/` without publishing to GitHub:
```bash
# Builds the installer into release/ (and opens the .dmg window on macOS)
just package        # or: pnpm run package
```
- **macOS:** `release/AwapiLasso-<version>-<arch>.dmg` (After dragging `AwapiLasso.app` to `/Applications`, run `xattr -cr /Applications/AwapiLasso.app` once to clear Gatekeeper quarantine).
- **Windows:** `release/AwapiLasso-<version>-<arch>-setup.exe` (NSIS) and `.msi`.
- **Linux:** `release/AwapiLasso-<version>-<arch>.AppImage` and `.deb`.

### 3. Build Multi-OS Installers & Publish Releases on GitHub
Cross-platform installers (macOS `.dmg`, Windows `.exe`/`.msi`, Linux `.AppImage`/`.deb`) are built in parallel on GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)).

#### Option A — From Terminal via `just` (Recommended)
Requires the [GitHub CLI (`gh`)](https://cli.github.com/) authenticated (`gh auth login`). Choose a new version number (e.g., `0.1.1` or `0.2.0`):
```bash
# 1. Cut a Draft Release on GitHub (bumps package.json, commits, tags v0.1.1, and pushes to trigger GitHub Actions):
just release 0.1.1

# 2. Once the "Release Builds" GitHub Action finishes, publish the draft as Latest:
just publish 0.1.1

# Or do both in one command (waits for GitHub Actions to finish and auto-publishes):
just release 0.1.1 publish
```

#### Option B — Directly in the GitHub Web UI
1. **Trigger the Build:** Go to **GitHub → Actions → [Release Builds](https://github.com/awapi/awapi-lasso/actions/workflows/release.yml)** → click **Run workflow** → select `main` → click **Run workflow**.
2. **Publish the Release:** Once the macOS, Windows, and Linux jobs complete, go to **GitHub → [Releases](https://github.com/awapi/awapi-lasso/releases)**, edit the generated **Draft** release, check **"Set as the latest release"**, and click **Publish release**.

---

## 📚 Documentation & Specifications

- 📋 [**Product & Technical Requirements (`docs/requirements.md`)**](docs/requirements.md) — Complete functional & non-functional requirements, architecture, and security model.
- 📄 [**`.awjc` / `.awj` Collection File Format Spec (`docs/file-format-spec.md`)**](docs/file-format-spec.md) — Annotated YAML schema, OAuth 2.0 & environment configurations, secret handling, and OS file associations.
- 🗺️ [**Features & Roadmap (`docs/features.md`)**](docs/features.md) — Full feature breakdown of what AwapiLasso does and its planned roadmap.
- 🚀 [**Release, Packaging & CI/CD Process (`docs/release-process.md`)**](docs/release-process.md) — GitHub Actions workflows, Windows/macOS/Linux installer configurations, and `justfile` release automation.
- 🧭 [**Agent Instructions (`AGENTS.md`)**](AGENTS.md) — Project conventions, Electron Main/Preload/Renderer boundaries, and mandatory testing rules.

---

## 📄 License

This project is licensed under the [Apache License 2.0](LICENSE).