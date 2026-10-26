#!/usr/bin/env bash
# Linux only: fail if node-pty's compiled binary needs a newer glibc than the
# oldest distros we support (Ubuntu 22.04 / Linux Mint 21 ship glibc 2.35).
# A newer build image can silently raise this floor; without the check the
# integrated terminal would just be unavailable on those systems.
set -euo pipefail

MAX_GLIBC="${MAX_GLIBC:-2.35}"
BINARY="$(node -p "require('path').join(require('path').dirname(require.resolve('node-pty/package.json')), 'build', 'Release', 'pty.node')")"

if [ ! -f "$BINARY" ]; then
  echo "node-pty binary not found at $BINARY" >&2
  exit 1
fi

required="$(objdump -T "$BINARY" | grep -o 'GLIBC_[0-9.]*' | sed 's/GLIBC_//' | sort -uV | tail -1)"
echo "node-pty requires glibc >= ${required} (supported floor: ${MAX_GLIBC})"

if [ "$(printf '%s\n%s\n' "$required" "$MAX_GLIBC" | sort -V | tail -1)" != "$MAX_GLIBC" ]; then
  echo "::error::node-pty needs glibc ${required}, newer than the supported floor ${MAX_GLIBC} (2.35 = Ubuntu 22.04 / Linux Mint 21). Build Linux releases on an older image." >&2
  exit 1
fi
