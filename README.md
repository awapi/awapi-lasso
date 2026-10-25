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

## 📚 Documentation & Specifications

- 📋 [**Product & Technical Requirements (`docs/requirements.md`)**](docs/requirements.md) — Complete functional & non-functional requirements, architecture, and security model.
- 📄 [**`.awjc` / `.awj` Collection File Format Spec (`docs/file-format-spec.md`)**](docs/file-format-spec.md) — Annotated YAML schema, OAuth 2.0 & environment configurations, secret handling, and OS file associations.
- 🗺️ [**Features & Roadmap (`docs/features.md`)**](docs/features.md) — Full feature breakdown of what AwapiLasso does and its planned roadmap.
- 🚀 [**Release, Packaging & CI/CD Process (`docs/release-process.md`)**](docs/release-process.md) — GitHub Actions workflows, Windows/macOS/Linux installer configurations, and `justfile` release automation.
- 🧭 [**Agent Instructions (`AGENTS.md`)**](AGENTS.md) — Project conventions, Electron Main/Preload/Renderer boundaries, and mandatory testing rules.

---

## 📄 License

This project is licensed under the [Apache License 2.0](LICENSE).