import { describe, it, expect, vi } from 'vitest';
import type { SpawnOptions } from 'child_process';
import {
  resolveTerminalCwd,
  sanitizeTerminalEnv,
  openExternalTerminal,
  type ExternalTerminalDeps,
  type SpawnedProcess,
} from './externalTerminal';

// Minimal stand-ins for the platform-native `path` helpers injected by main.ts.
const posixPath = {
  dirname: (p: string) => p.replace(/\/[^/]*$/, '') || '/',
  isAbsolute: (p: string) => p.startsWith('/'),
};
const win32Path = {
  dirname: (p: string) => p.replace(/\\[^\\]*$/, ''),
  isAbsolute: (p: string) => /^[a-zA-Z]:\\/.test(p),
};

type SpawnCall = { command: string; args: string[]; options: SpawnOptions };

/** Creates a spawn mock where commands listed in `missing` emit 'error' (ENOENT). */
function createSpawn(missing: string[] = []) {
  const calls: SpawnCall[] = [];
  const unref = vi.fn();
  const spawn = vi.fn((command: string, args: string[], options: SpawnOptions): SpawnedProcess => {
    calls.push({ command, args, options });
    const listeners: Record<string, (err?: Error) => void> = {};
    queueMicrotask(() => {
      if (missing.includes(command)) listeners.error?.(new Error('ENOENT'));
      else listeners.spawn?.();
    });
    return {
      once: (event, listener) => {
        listeners[event] = listener;
      },
      unref,
    };
  });
  return { spawn, calls, unref };
}

function createDeps(overrides: Partial<ExternalTerminalDeps> = {}): ExternalTerminalDeps {
  return {
    platform: 'darwin',
    env: {},
    spawn: createSpawn().spawn,
    isDirectory: p => p === '/Users/me/project',
    exists: () => false,
    readFile: () => null,
    realpath: p => p,
    homeDir: '/Users/me',
    ...posixPath,
    ...overrides,
  };
}

/** Linux deps where the given terminals exist in /usr/bin. */
function linuxDeps(installed: string[], overrides: Partial<ExternalTerminalDeps> = {}) {
  return createDeps({
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    exists: p => installed.some(name => p === `/usr/bin/${name}`),
    ...overrides,
  });
}

describe('resolveTerminalCwd', () => {
  const isDirectory = (p: string) => ['/Users/me/project', 'C:\\work', 'd:\\data'].includes(p);
  const posix = { platform: 'darwin' as const, isDirectory, ...posixPath };
  const win32 = { platform: 'win32' as const, isDirectory, ...win32Path };

  it('returns the parent directory of a file', () => {
    expect(resolveTerminalCwd('/Users/me/project/a.txt', posix)).toBe('/Users/me/project');
  });

  it('returns the directory itself when given a directory', () => {
    expect(resolveTerminalCwd('/Users/me/project', { ...posix, platform: 'linux' })).toBe('/Users/me/project');
  });

  it('handles Windows paths and upper-cases the drive letter', () => {
    expect(resolveTerminalCwd('C:\\work\\file.ts', win32)).toBe('C:\\work');
    expect(resolveTerminalCwd('d:\\data\\x.txt', win32)).toBe('D:\\data');
  });

  it('rejects invalid, relative, or missing paths', () => {
    expect(resolveTerminalCwd(undefined, posix)).toBeNull();
    expect(resolveTerminalCwd('', posix)).toBeNull();
    expect(resolveTerminalCwd(42, posix)).toBeNull();
    expect(resolveTerminalCwd('relative/a.txt', posix)).toBeNull();
    expect(resolveTerminalCwd('/missing/dir/a.txt', posix)).toBeNull();
  });
});

describe('sanitizeTerminalEnv', () => {
  it('removes Electron and Vite variables but keeps the rest', () => {
    expect(
      sanitizeTerminalEnv({
        PATH: '/usr/bin',
        HOME: '/Users/me',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
        NODE_ENV: 'production',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
      }),
    ).toEqual({ PATH: '/usr/bin', HOME: '/Users/me' });
  });
});

describe('openExternalTerminal', () => {
  it('opens Terminal.app detached in the file folder with a sanitized env', async () => {
    const { spawn, calls, unref } = createSpawn();
    const result = await openExternalTerminal(
      '/Users/me/project/a.txt',
      createDeps({ spawn, env: { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' } }),
    );

    expect(result).toEqual({ ok: true, cwd: '/Users/me/project', command: 'open' });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['-a', 'Terminal', '.']);
    expect(calls[0].options).toMatchObject({
      cwd: '/Users/me/project',
      env: { PATH: '/bin' },
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: false,
    });
    expect(unref).toHaveBeenCalled();
  });

  it('honors a configured macOS app or a custom app name', async () => {
    const { spawn, calls } = createSpawn();
    const deps = createDeps({ spawn, env: { HOME: '/Users/me' }, exists: p => p === '/Applications/iTerm.app' });

    await openExternalTerminal('/Users/me/project/a.txt', deps, 'iterm');
    await openExternalTerminal('/Users/me/project/a.txt', deps, 'Hyper');

    expect(calls.map(c => c.args)).toEqual([
      ['-a', '/Applications/iTerm.app', '.'],
      ['-a', 'Hyper', '.'],
    ]);
  });

  it('launches through cmd start with verbatim arguments on Windows', async () => {
    const { spawn, calls } = createSpawn();
    const result = await openExternalTerminal(
      'c:\\work\\file.ts',
      createDeps({
        platform: 'win32',
        env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe', SystemRoot: 'C:\\Windows' },
        spawn,
        isDirectory: p => p === 'c:\\work',
        ...win32Path,
      }),
    );

    expect(result).toEqual({ ok: true, cwd: 'C:\\work', command: 'C:\\Windows\\system32\\cmd.exe' });
    expect(calls[0].args).toEqual(['/d', '/c', 'start', '""', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe']);
    expect(calls[0].options).toMatchObject({ cwd: 'C:\\work', windowsVerbatimArguments: true });
  });

  it('passes the working-directory flag to Linux terminals that need it', async () => {
    const { spawn, calls } = createSpawn();
    await openExternalTerminal('/Users/me/project/a.txt', linuxDeps(['gnome-terminal'], { spawn }));

    expect(calls[0]).toMatchObject({
      command: '/usr/bin/gnome-terminal',
      args: ['--working-directory=/Users/me/project'],
    });
  });

  it('falls back to the next Linux terminal when one fails to start', async () => {
    const { spawn, calls } = createSpawn(['/usr/bin/x-terminal-emulator']);
    const result = await openExternalTerminal(
      '/Users/me/project/a.txt',
      linuxDeps(['x-terminal-emulator', 'konsole'], { spawn }),
    );

    expect(result).toMatchObject({ ok: true, command: '/usr/bin/konsole' });
    expect(calls.map(c => c.command)).toEqual(['/usr/bin/x-terminal-emulator', '/usr/bin/konsole']);
    expect(calls[1].args).toEqual(['--workdir', '/Users/me/project']);
  });

  it('prefers $TERMINAL in automatic mode on Linux', async () => {
    const { spawn, calls } = createSpawn();
    await openExternalTerminal(
      '/Users/me/project/a.txt',
      linuxDeps(['x-terminal-emulator', 'ghostty'], { spawn, env: { PATH: '/usr/bin', TERMINAL: 'ghostty' } }),
    );

    expect(calls[0]).toMatchObject({ command: '/usr/bin/ghostty', args: ['--working-directory=/Users/me/project'] });
  });

  it('treats a synchronous spawn exception as a failed candidate', async () => {
    const fallback = createSpawn();
    const spawn = vi.fn((command: string, args: string[], options: SpawnOptions) => {
      if (command === '/usr/bin/x-terminal-emulator') throw new Error('EACCES');
      return fallback.spawn(command, args, options);
    });
    const result = await openExternalTerminal(
      '/Users/me/project/a.txt',
      linuxDeps(['x-terminal-emulator', 'xterm'], { spawn }),
    );

    expect(result).toMatchObject({ ok: true, command: '/usr/bin/xterm' });
  });

  it('does not fall back when an explicit terminal fails, and names it in the error', async () => {
    const { spawn, calls } = createSpawn(['/usr/bin/konsole']);
    const result = await openExternalTerminal(
      '/Users/me/project/a.txt',
      linuxDeps(['konsole', 'xterm'], { spawn }),
      'konsole',
    );

    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      ok: false,
      error: 'Could not start "Konsole". Check the External Terminal setting in Preferences.',
    });
  });

  it('reports an error when no terminal can be started automatically', async () => {
    const { spawn } = createSpawn(['open']);
    expect(await openExternalTerminal('/Users/me/project/a.txt', createDeps({ spawn }))).toEqual({
      ok: false,
      error: 'No supported terminal application was found.',
    });
  });

  it('opens in the home folder when there is no file (unsaved collections)', async () => {
    const { spawn, calls } = createSpawn();
    const deps = createDeps({ spawn, isDirectory: p => p === '/Users/me' });

    expect(await openExternalTerminal(null, deps)).toEqual({ ok: true, cwd: '/Users/me', command: 'open' });
    expect(await openExternalTerminal('', deps)).toMatchObject({ ok: true, cwd: '/Users/me' });
    expect(calls.map(c => c.options.cwd)).toEqual(['/Users/me', '/Users/me']);
  });

  it('reports an error and does not spawn when the folder is missing', async () => {
    const { spawn } = createSpawn();
    expect(await openExternalTerminal('/gone/a.txt', createDeps({ spawn }))).toEqual({
      ok: false,
      error: 'The folder for this file does not exist.',
    });
    expect(spawn).not.toHaveBeenCalled();
  });
});
