# This file defines the common tasks for developing this project using the `just` command runner.
# See https://github.com/casey/just for more information.

# Use bash on Linux/macOS and PowerShell on Windows (bash is not guaranteed there).
# Recipes that need shell-specific syntax have [unix] / [windows] variants.
set shell := ["bash", "-c"]
set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-Command"]

# Show available commands by default
default:
    @just --list
    
# Install dependencies
install:
    pnpm install

# Run the application in development mode (automatically starts the Sample REST + GraphQL + OAuth2 API on port 8080)
dev:
    pnpm run dev

# Start only the standalone Sample REST + GraphQL + OAuth2 API server (default port 8080)
sample-api:
    pnpm run sample-api

# Run unit tests continuously (watch mode)
test:
    pnpm run test:watch

# Run unit tests once
test-once:
    pnpm run test

# Typecheck the codebase strictly
typecheck:
    pnpm run typecheck

# Build the application into production bundles
build:
    pnpm run build

# Package the app for local installation (cross-platform, no GitHub publish)
[windows]
package:
    pnpm run package
    @echo ""
    @echo "Build complete. Installer is at:"
    @Get-ChildItem release/*.exe | ForEach-Object { $_.FullName }

# Package the app for local installation (cross-platform, no GitHub publish)
[unix]
package:
    pnpm run package
    @OS=$(uname -s); \
    if [ "$OS" = "Darwin" ]; then \
        open release/AwapiLasso-*.dmg; \
        echo "Drag AwapiLasso to /Applications in the window that just opened."; \
        echo "Then run: xattr -cr /Applications/AwapiLasso.app"; \
    elif [ "$OS" = "Linux" ]; then \
        echo ""; \
        echo "✓ Build complete. AppImage is at:"; \
        ls release/AwapiLasso-*.AppImage 2>/dev/null || ls release/*.AppImage 2>/dev/null; \
        echo ""; \
        echo "To run it:  chmod +x release/AwapiLasso-*.AppImage && ./release/AwapiLasso-*.AppImage"; \
    else \
        echo ""; \
        echo "✓ Build complete. Installer is at:"; \
        ls release/*.exe 2>/dev/null; \
    fi

# Clear caches and build outputs
[windows]
clean:
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue dist, node_modules
    pnpm store prune

# Clear caches and build outputs
[unix]
clean:
    rm -rf dist node_modules
    pnpm store prune

# Create a new version tag (e.g. 0.1.0) and push to trigger the GitHub Actions
# release workflow. The workflow builds on macOS / Linux / Windows and uploads
# the artifacts to a *draft* GitHub Release (electron-builder's default in a
# multi-OS matrix, to avoid race conditions between runners).
#
# By default the release stays as a draft so you can review it. Pass `publish`
# as the second argument to automatically promote it to the latest release
# once the workflow finishes (end-users' update check only sees published
# releases).
#
#   just release 0.1.0           # draft only (default)
#   just release 0.1.0 publish   # draft + auto-publish when CI finishes
#
# Auto-publish requires the GitHub CLI (`brew install gh` + `gh auth login`).
release version mode="draft":
    @echo "Bumping package.json to {{version}}..."
    pnpm version {{version}} --no-git-tag-version
    git add package.json pnpm-lock.yaml
    git commit -m "chore: release v{{version}}"
    git push
    @echo "Creating and pushing release tag v{{version}}..."
    git tag v{{version}}
    git push origin v{{version}}
    @echo ""
    @echo "Tag pushed. GitHub Actions is now building and uploading to a draft release."
    @just _release-{{mode}} {{version}}

_release-draft version:
    @echo "  Draft will remain a draft. Publish later with: just publish {{version}}"

[windows]
_release-publish version:
    @if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host "gh CLI not found. Install with: winget install GitHub.cli"; exit 1 }
    @echo "Waiting for the release workflow to finish before publishing..."
    @Start-Sleep -Seconds 15
    @gh run watch --exit-status (gh run list --workflow='Release Builds' --limit 1 --json databaseId --jq '.[0].databaseId')
    @just publish {{version}}

[unix]
_release-publish version:
    @command -v gh >/dev/null 2>&1 || { echo "gh CLI not found. Install with: brew install gh"; exit 1; }
    @echo "Waiting for the release workflow to finish before publishing..."
    @sleep 15
    @gh run watch --exit-status $(gh run list --workflow='Release Builds' --limit 1 --json databaseId --jq '.[0].databaseId') || { echo "Workflow failed — draft left in place for inspection."; exit 1; }
    @just publish {{version}}

# Promote an existing draft GitHub Release to published + mark it as the
# latest release. This is what makes the in-app update notifier see it.
# Requires the GitHub CLI (`brew install gh` and `gh auth login`).
[windows]
publish version:
    @if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Write-Host "gh CLI not found. Install with: winget install GitHub.cli"; exit 1 }
    @echo "Publishing draft release v{{version}}..."
    gh release edit v{{version}} --draft=false --latest
    @echo "v{{version}} is now the latest release."
    @echo "  https://github.com/awapi/awapi-lasso/releases/tag/v{{version}}"

# Promote an existing draft GitHub Release to published + mark it as the
# latest release. This is what makes the in-app update notifier see it.
# Requires the GitHub CLI (`brew install gh` and `gh auth login`).
[unix]
publish version:
    @command -v gh >/dev/null 2>&1 || { echo "gh CLI not found. Install with: brew install gh"; exit 1; }
    @echo "Publishing draft release v{{version}}..."
    gh release edit v{{version}} --draft=false --latest
    @echo "✓ v{{version}} is now the latest release."
    @echo "  https://github.com/awapi/awapi-lasso/releases/tag/v{{version}}"
