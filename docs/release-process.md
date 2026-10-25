# Release, Packaging & CI/CD Process

AwapiLasso follows the battle-tested cross-platform build, installer, and GitHub Actions release pipeline established in `awapi-editor`.

---

## 1. Packaging Targets Across Operating Systems

| OS | Target Formats | Architectures | File Associations & OS Integration |
|---|---|---|---|
| **macOS** | `.dmg` + `scripts/install-macos.sh` | `arm64`, `x64` | Registers `.awjc` & `.awj` (`CFBundleDocumentTypes`), handles Finder double-click via `app.on('open-file')` |
| **Windows** | `.exe` (NSIS), `.msi` | `x64`, `arm64` | Registers `.awjc` & `.awj` extensions + `"Open with AwapiLasso"` Explorer right-click context menu (`HKCU\Software\Classes`) |
| **Linux** | `.AppImage`, `.deb` | `x64`, `arm64` | Registers `.awjc` & `.awj` MIME types (`application/x-awapi-lasso-collection`) in `.desktop` entry |

Local packaging (current OS only):
```bash
pnpm run package
# or via just:
just package
```

Artifacts are written to `release/`.

---

## 2. `package.json` (`electron-builder`) Configuration Reference

```json
{
  "name": "awapi-lasso",
  "version": "0.1.0",
  "description": "A fast, lightweight, cross-platform HTTP, RESTful, and GraphQL client",
  "main": "dist/main/main.js",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "vite",
    "build": "cross-env NODE_ENV=production vite build",
    "package": "cross-env NODE_ENV=production vite build && electron-builder",
    "release": "cross-env NODE_ENV=production vite build && electron-builder --publish always",
    "typecheck": "tsc --noEmit",
    "icons": "node scripts/generate-icons.js"
  },
  "build": {
    "appId": "com.awapi.awapilasso",
    "productName": "AwapiLasso",
    "publish": ["github"],
    "directories": {
      "output": "release"
    },
    "fileAssociations": [
      {
        "ext": "awjc",
        "name": "AwapiLasso Collection",
        "description": "AwapiLasso API Collection File",
        "mimeType": "application/x-awapi-lasso-collection",
        "role": "Editor",
        "icon": "build/icon"
      },
      {
        "ext": "awj",
        "name": "AwapiLasso Collection",
        "description": "AwapiLasso API Collection File",
        "mimeType": "application/x-awapi-lasso",
        "role": "Editor",
        "icon": "build/icon"
      }
    ],
    "mac": {
      "icon": "build/icon.icns",
      "category": "public.app-category.developer-tools",
      "target": ["dmg"],
      "hardenedRuntime": false,
      "gatekeeperAssess": false,
      "identity": "-"
    },
    "win": {
      "icon": "build/icon.ico",
      "target": ["nsis", "msi"]
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "artifactName": "${productName}-${version}-${arch}-setup.${ext}"
    },
    "msi": {
      "oneClick": false,
      "perMachine": false,
      "runAfterFinish": true,
      "artifactName": "${productName}-${version}-${arch}.${ext}"
    },
    "linux": {
      "icon": "build/icon-512x512.png",
      "category": "Development",
      "target": ["AppImage", "deb"],
      "artifactName": "${productName}-${version}-${arch}.${ext}"
    },
    "deb": {
      "maintainer": "awapi <oyesil@gmail.com>"
    },
    "files": [
      "dist/**/*",
      "build/**/*"
    ],
    "npmRebuild": false
  }
}
```

---

## 3. GitHub Actions Workflows (`.github/workflows/`)

### 3.1 Continuous Integration (`.github/workflows/ci.yml`)
Runs on every push and pull request targeting `main`:
1. **`build_and_test` matrix (`ubuntu-latest`, `windows-latest`):**
   - Checkout (`actions/checkout@v5`)
   - Setup Node.js 22 (`actions/setup-node@v5`)
   - Setup `pnpm` (`pnpm/action-setup@v6`)
   - Install dependencies (`pnpm install --frozen-lockfile`)
   - Security audit (`pnpm audit --audit-level=high` on Ubuntu)
   - Typecheck (`pnpm run typecheck`)
   - Unit & Component Tests (`pnpm run test`)
   - Production bundle build (`pnpm run build`)
2. **`justfile` verification matrix (`ubuntu-latest`, `macos-latest`, `windows-latest`):**
   - Setup `just` (`extractions/setup-just@v3`)
   - Exercises `just install`, `just build`, `just _release-draft 0.0.0`, dry-run OS recipes (`just --dry-run package`, `just --dry-run publish 0.0.0`), and `just clean` across bash (Unix) and PowerShell (Windows).

### 3.2 Multi-OS Release Builds (`.github/workflows/release.yml`)
Triggered by pushing a version tag (`v*`, e.g., `v0.1.0`) or via `workflow_dispatch`:
- Runs across `macos-latest`, `ubuntu-latest`, and `windows-latest` with `permissions: contents: write`.
- Executes `pnpm run release` with `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, which builds and uploads installers to a **draft GitHub Release**.
- Uploads workflow artifacts (`awapi-lasso-macos-latest`, `awapi-lasso-ubuntu-latest`, `awapi-lasso-windows-latest`) with a 7-day retention window.

---

## 4. Cutting a Release with `just`

1. Ensure `main` is green (`just typecheck && just test-once`).
2. Cut a draft release (or auto-publish when CI completes):
   ```bash
   # Create a draft release on GitHub:
   just release 0.1.0

   # Or create a draft release and auto-publish once CI finishes:
   just release 0.1.0 publish
   ```
3. To promote an existing draft release to published + latest:
   ```bash
   just publish 0.1.0
   ```

---

## 5. Code Signing & Platform Workarounds (Until Paid Certificates Are Provisioned)

Just like `AwapiEditor`, AwapiLasso ships with ad-hoc signing (`identity: "-"`) on macOS so Apple Silicon Macs have a valid bundle seal without requiring a paid Apple Developer certificate during initial development:
- **macOS (one-line automatic install/update):**
  ```bash
  curl -fsSL https://raw.githubusercontent.com/awapi/awapi-lasso/main/scripts/install-macos.sh | bash
  ```
  Downloads the latest `.dmg`, installs `AwapiLasso.app` to `/Applications`, and clears quarantine attributes (`xattr -cr "/Applications/AwapiLasso.app"`).
- **macOS (manual `.dmg`):** Right-click `AwapiLasso.app` → **Open** → **Open** on first launch, or run `xattr -cr "/Applications/AwapiLasso.app"`.
- **Windows:** On first launch of the unsigned `.exe` or `.msi`, click **More info → Run anyway** on the Windows SmartScreen prompt.
- **Linux:** For `.AppImage`, run `chmod +x AwapiLasso-*.AppImage && ./AwapiLasso-*.AppImage`; for `.deb`, run `sudo dpkg -i AwapiLasso-*.deb`.
