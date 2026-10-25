#!/usr/bin/env bash
# Install or update AwapiLasso on macOS directly from the latest GitHub Release.
# Automatically downloads the latest DMG, copies AwapiLasso.app to /Applications,
# and removes macOS Gatekeeper quarantine attributes (xattr -cr).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/awapi/awapi-lasso/main/scripts/install-macos.sh | bash

set -euo pipefail

REPO="awapi/awapi-lasso"
APP_NAME="AwapiLasso.app"
INSTALL_DIR="/Applications"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Error: This installer script is for macOS only." >&2
  exit 1
fi

ARCH="$(uname -m)"
if [[ "$ARCH" == "arm64" ]]; then
  ARCH_PATTERN="arm64"
else
  ARCH_PATTERN="x64|x86_64"
fi

echo "==> Fetching latest release info from ${REPO}..."
RELEASE_JSON="$(curl -fsSL -H "Accept: application/vnd.github+json" "$API_URL")"

TAG_NAME="$(printf '%s' "$RELEASE_JSON" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/')"
DMG_URL="$(printf '%s' "$RELEASE_JSON" \
  | grep -oE 'https://github\.com/[^"]+\.dmg' \
  | grep -E "(${ARCH_PATTERN})" \
  | head -n1 || true)"

# Fallback to any .dmg asset if architecture-specific name wasn't matched
if [[ -z "$DMG_URL" ]]; then
  DMG_URL="$(printf '%s' "$RELEASE_JSON" \
    | grep -oE 'https://github\.com/[^"]+\.dmg' \
    | head -n1 || true)"
fi

if [[ -z "$DMG_URL" ]]; then
  echo "Error: Could not find a .dmg asset in the latest release (${TAG_NAME:-unknown})." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
DMG_PATH="${TMP_DIR}/AwapiLasso.dmg"
MOUNT_POINT=""

cleanup() {
  if [[ -n "$MOUNT_POINT" && -d "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" -quiet 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "==> Downloading AwapiLasso ${TAG_NAME} (${DMG_URL##*/})..."
curl -fL --progress-bar "$DMG_URL" -o "$DMG_PATH"

echo "==> Mounting disk image..."
MOUNT_POINT="$(hdiutil attach "$DMG_PATH" -nobrowse -noautoopen \
  | awk -F'\t' '/\/Volumes\// { print $NF; exit }')"

if [[ -z "$MOUNT_POINT" || ! -d "${MOUNT_POINT}/${APP_NAME}" ]]; then
  echo "Error: Failed to locate ${APP_NAME} inside mounted DMG." >&2
  exit 1
fi

echo "==> Installing ${APP_NAME} to ${INSTALL_DIR}..."
rm -rf "${INSTALL_DIR}/${APP_NAME}"
cp -R "${MOUNT_POINT}/${APP_NAME}" "${INSTALL_DIR}/${APP_NAME}"

echo "==> Clearing macOS quarantine attributes..."
xattr -cr "${INSTALL_DIR}/${APP_NAME}"

echo "✓ AwapiLasso ${TAG_NAME} installed to ${INSTALL_DIR}/${APP_NAME}!"
echo "  You can now open AwapiLasso from Spotlight or Launchpad with no Gatekeeper warnings."
