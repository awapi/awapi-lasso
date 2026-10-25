---
name: release
description: "Package, cut, and publish cross-platform releases for AwapiLasso across macOS (.dmg), Windows (.exe, .msi), and Linux (.AppImage, .deb), including .awjc / .awj file associations. Use when bumping versions, modifying electron-builder configuration in package.json, or updating .github/workflows/release.yml."
---

# Packaging & Release Workflow

## Overview
AwapiLasso uses Vite + `electron-builder` to build installers for macOS (`.dmg`), Windows (`.exe` NSIS and `.msi`), and Linux (`.AppImage` and `.deb`), registering `.awjc` and `.awj` file associations on all three platforms. Multi-platform releases are built via GitHub Actions (`.github/workflows/release.yml`) and managed with `just` recipes (`justfile`).

## When to Use
- Cutting a new version release or promoting a draft release
- Updating `build` or `fileAssociations` configuration in `package.json` or `.github/workflows/release.yml`
- Updating platform installation instructions in `README.md`, `docs/release-process.md`, or `scripts/install-macos.sh`

## Step-by-Step Procedure

### 1. Pre-Release Checks
Verify `main` is clean and all checks pass:
```bash
pnpm run typecheck
pnpm run test
pnpm run build
```

### 2. Local Packaging (Single OS)
To build installers locally into `release/` without publishing to GitHub:
```bash
pnpm run package
# or:
just package
```

### 3. Cutting a GitHub Release
Use the `justfile` release recipes (only run git tag/push commands when explicitly requested by the user):
- **Draft release only (default):**
  ```bash
  just release X.Y.Z
  ```
  Bumps `package.json`, commits, tags `vX.Y.Z`, and pushes to trigger `.github/workflows/release.yml`, which uploads artifacts to a draft GitHub Release.
- **Draft + auto-publish when CI completes:**
  ```bash
  just release X.Y.Z publish
  ```
- **Publish an existing draft release:**
  ```bash
  just publish X.Y.Z
  ```

### 4. Platform Signing & File Association Notes
- **File Associations:** Ensure `build.fileAssociations` in `package.json` includes both `awjc` and `awj` so double-clicking collection files opens AwapiLasso on macOS, Windows, and Linux.
- **macOS:** Configured in `package.json` (`build.mac`) with `identity: "-"` (ad-hoc signing), `hardenedRuntime: false`, and `gatekeeperAssess: false`. Users can install/update without Gatekeeper prompts via `scripts/install-macos.sh`.
- **Windows:** Builds both `nsis` (`-setup.exe`) and `msi` (`.msi`) targets in `package.json` (`build.win`).
- **Linux:** Builds `AppImage` and `deb` targets in `package.json` (`build.linux`).
