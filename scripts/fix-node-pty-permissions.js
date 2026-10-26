#!/usr/bin/env node
// node-pty's macOS prebuilds ship `spawn-helper` without the executable bit,
// which makes every pty spawn fail with "posix_spawnp failed". Restore it
// after install so both `pnpm dev` and packaged builds can start shells.
const fs = require('fs');
const path = require('path');

function fixNodePtyPermissions() {
  if (process.platform === 'win32') return;
  let ptyDir;
  try {
    ptyDir = path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    return;
  }
  const candidates = [path.join(ptyDir, 'build', 'Release', 'spawn-helper')];
  const prebuildsDir = path.join(ptyDir, 'prebuilds');
  if (fs.existsSync(prebuildsDir)) {
    for (const entry of fs.readdirSync(prebuildsDir)) {
      candidates.push(path.join(prebuildsDir, entry, 'spawn-helper'));
    }
  }
  for (const file of candidates) {
    if (fs.existsSync(file)) fs.chmodSync(file, 0o755);
  }
}

fixNodePtyPermissions();
