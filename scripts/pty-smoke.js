#!/usr/bin/env node
// Smoke test for the integrated terminal's native dependency: spawns a real
// shell through node-pty (ConPTY on Windows) and checks its output.
// Usage: node scripts/pty-smoke.js
const pty = require('node-pty');

const isWindows = process.platform === 'win32';
const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
const args = isWindows ? ['/d', '/c', 'echo PTY_SMOKE_OK'] : ['-c', 'echo PTY_SMOKE_OK'];

const term = pty.spawn(shell, args, { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd(), env: process.env });
let output = '';
const timer = setTimeout(() => {
  console.error(`node-pty smoke test timed out. Output so far: ${JSON.stringify(output)}`);
  process.exit(1);
}, 15000);

term.onData(data => {
  output += data;
});
term.onExit(({ exitCode }) => {
  clearTimeout(timer);
  // ConPTY may deliver the last chunk just after exit.
  setTimeout(() => {
    if (exitCode === 0 && output.includes('PTY_SMOKE_OK')) {
      console.log(`node-pty OK (${process.platform}-${process.arch}, ${shell})`);
      process.exit(0);
    }
    console.error(`node-pty smoke test failed (exit ${exitCode}). Output: ${JSON.stringify(output)}`);
    process.exit(1);
  }, 200);
});
