// This module avoids runtime Node built-in imports so it can be unit-tested
// directly in the renderer-configured Vitest environment. All OS access is
// injected via `CliCommandDeps` / `CliArgDeps` from `main.ts`.

export const CLI_COMMAND_NAME = 'awlasso';

export interface CliCommandStatus {
  /** True when CLI installation is supported on this platform and environment. */
  supported: boolean;
  /** True when the `awlasso` CLI launcher is currently installed on disk. */
  enabled: boolean;
  /** Target path where the `awlasso` launcher is (or will be) installed. */
  commandPath: string | null;
}

export type CliCommandUpdateResult =
  | { ok: true; enabled: boolean; commandPath: string | null }
  | { ok: false; enabled: boolean; commandPath: string | null; error: string };

export interface CliCommandDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  /** Full path to the Electron / app executable (`process.execPath`). */
  execPath: string;
  /** False in `vite` dev mode where `execPath` is the raw `electron` binary. */
  isPackaged: boolean;
  /** Optional path to the app entry script (`dist/main/main.js`) used in dev mode. */
  appEntryPath?: string;
  exists: (p: string) => boolean;
  mkdir: (p: string) => void;
  writeFile: (p: string, content: string, mode?: number) => void;
  unlink: (p: string) => void;
}

export interface CliArgDeps {
  platform: NodeJS.Platform;
  /** Whether a file (not a directory) exists at `p`. */
  isFile: (p: string) => boolean;
  /** Whether a directory exists at `p`. */
  isDirectory?: (p: string) => boolean;
}

/** Reads an env var; case-insensitive on Windows. */
function getEnv(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, key: string): string | undefined {
  if (platform !== 'win32') return env[key];
  const match = Object.keys(env).find(k => k.toLowerCase() === key.toLowerCase());
  return match ? env[match] : undefined;
}

function sep(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '\\' : '/';
}

function joinPath(platform: NodeJS.Platform, ...parts: string[]): string {
  const s = sep(platform);
  return parts
    .map((part, i) => (i === 0 ? part.replace(/[\\/]+$/, '') : part.replace(/^[\\/]+|[\\/]+$/g, '')))
    .filter(Boolean)
    .join(s);
}

function dirnamePath(platform: NodeJS.Platform, p: string): string {
  const normalized = p.replace(/[\\/]+$/, '');
  const idx = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (idx === -1) return '.';
  if (idx === 0) return sep(platform);
  if (platform === 'win32' && idx === 2 && /^[a-zA-Z]:/.test(normalized)) {
    return `${normalized.slice(0, 2)}\\`;
  }
  return normalized.slice(0, idx);
}

function isAbsolutePath(platform: NodeJS.Platform, p: string): boolean {
  return platform === 'win32' ? /^([a-zA-Z]:[\\/]|\\\\)/.test(p) : p.startsWith('/');
}

/** Resolves a potentially relative path against `cwd` without importing `path`. */
export function resolvePathFromCwd(platform: NodeJS.Platform, cwd: string, target: string): string {
  const s = sep(platform);
  const combined = isAbsolutePath(platform, target)
    ? target
    : cwd
      ? `${cwd.replace(/[\\/]+$/, '')}${s}${target}`
      : target;

  if (platform === 'win32') {
    const uncMatch = combined.match(/^(\\\\[^\\/]+[\\/][^\\/]+)(.*)$/);
    const driveMatch = !uncMatch ? combined.match(/^([a-zA-Z]:)(.*)$/) : null;
    const prefix = uncMatch ? uncMatch[1].replace(/\//g, '\\') : driveMatch ? driveMatch[1] : '';
    const rest = uncMatch ? uncMatch[2] : driveMatch ? driveMatch[2] : combined;
    const isRooted = prefix.length > 0 || /^[\\/]/.test(rest);
    const segments = rest.split(/[\\/]+/).filter(Boolean);
    const stack: string[] = [];
    for (const seg of segments) {
      if (seg === '.') continue;
      if (seg === '..') {
        stack.pop();
      } else {
        stack.push(seg);
      }
    }
    return `${prefix}${isRooted ? '\\' : ''}${stack.join('\\')}`;
  }

  const isRooted = combined.startsWith('/');
  const segments = combined.split('/').filter(Boolean);
  const stack: string[] = [];
  for (const seg of segments) {
    if (seg === '.') continue;
    if (seg === '..') {
      stack.pop();
    } else {
      stack.push(seg);
    }
  }
  return `${isRooted ? '/' : ''}${stack.join('/')}` || (isRooted ? '/' : '.');
}

/**
 * Extracts all existing file and directory paths from an Electron `argv` array,
 * resolving relative paths against `workingDirectory` (which `second-instance`
 * supplies from the caller's shell `cwd`, or `process.cwd()` on initial startup).
 */
export function pathsFromArgv(
  argv: string[],
  isDev: boolean,
  workingDirectory: string,
  deps: CliArgDeps,
): { files: string[]; directories: string[] } {
  const candidates = argv.slice(isDev ? 2 : 1);
  const files: string[] = [];
  const directories: string[] = [];
  const seenFiles = new Set<string>();
  const seenDirs = new Set<string>();
  let afterDoubleDash = false;

  for (const arg of candidates) {
    if (!arg) continue;
    if (!afterDoubleDash && arg === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (!afterDoubleDash && arg.startsWith('-')) {
      continue;
    }

    const resolved = isAbsolutePath(deps.platform, arg)
      ? arg
      : workingDirectory
        ? resolvePathFromCwd(deps.platform, workingDirectory, arg)
        : arg;

    if (deps.isFile(resolved)) {
      const key = deps.platform === 'win32' ? resolved.toLowerCase() : resolved;
      if (!seenFiles.has(key)) {
        seenFiles.add(key);
        files.push(resolved);
      }
    } else if (deps.isDirectory?.(resolved)) {
      const key = deps.platform === 'win32' ? resolved.toLowerCase() : resolved;
      if (!seenDirs.has(key)) {
        seenDirs.add(key);
        directories.push(resolved);
      }
    }
  }

  return { files, directories };
}

/**
 * Extracts all existing file paths from an Electron `argv` array, resolving
 * relative paths against `workingDirectory`.
 */
export function fileArgsFromArgv(
  argv: string[],
  isDev: boolean,
  workingDirectory: string,
  deps: CliArgDeps,
): string[] {
  return pathsFromArgv(argv, isDev, workingDirectory, deps).files;
}

/**
 * Extracts all existing directory paths from an Electron `argv` array, resolving
 * relative paths against `workingDirectory`.
 */
export function directoryArgsFromArgv(
  argv: string[],
  isDev: boolean,
  workingDirectory: string,
  deps: CliArgDeps,
): string[] {
  return pathsFromArgv(argv, isDev, workingDirectory, deps).directories;
}

/**
 * Returns the primary and fallback paths where the `awlasso` CLI launcher is placed:
 * - Windows: `%LOCALAPPDATA%\Microsoft\WindowsApps\awlasso.cmd` (already in user PATH on Windows 10/11),
 *   plus a POSIX `awlasso` sibling script for Git Bash / MSYS2.
 * - macOS: `/usr/local/bin/awlasso` (preferred if writable), falling back to `/opt/homebrew/bin/awlasso` or `~/.local/bin/awlasso`.
 * - Linux: `~/.local/bin/awlasso` (standard XDG user bin directory), or `/usr/local/bin/awlasso`.
 */
export function resolveCliInstallPaths(
  deps: Pick<CliCommandDeps, 'platform' | 'env' | 'homeDir'>,
): { primary: string | null; companionPosix?: string; candidates: string[] } {
  if (deps.platform === 'win32') {
    const localAppData =
      getEnv(deps.env, 'win32', 'LOCALAPPDATA') ||
      (deps.homeDir ? joinPath('win32', deps.homeDir, 'AppData', 'Local') : '');
    if (!localAppData) {
      return { primary: null, candidates: [] };
    }
    const dir = joinPath('win32', localAppData, 'Microsoft', 'WindowsApps');
    const cmdPath = joinPath('win32', dir, `${CLI_COMMAND_NAME}.cmd`);
    const shPath = joinPath('win32', dir, CLI_COMMAND_NAME);
    return { primary: cmdPath, companionPosix: shPath, candidates: [cmdPath] };
  }

  if (deps.platform === 'darwin') {
    const candidates = [
      `/usr/local/bin/${CLI_COMMAND_NAME}`,
      `/opt/homebrew/bin/${CLI_COMMAND_NAME}`,
      ...(deps.homeDir ? [joinPath('darwin', deps.homeDir, '.local', 'bin', CLI_COMMAND_NAME)] : []),
    ];
    return { primary: candidates[0] ?? null, candidates };
  }

  if (deps.platform === 'linux') {
    const candidates = [
      ...(deps.homeDir ? [joinPath('linux', deps.homeDir, '.local', 'bin', CLI_COMMAND_NAME)] : []),
      `/usr/local/bin/${CLI_COMMAND_NAME}`,
    ];
    return { primary: candidates[0] ?? null, candidates };
  }

  return { primary: null, candidates: [] };
}

export interface LauncherScriptOptions {
  execPath: string;
  isPackaged?: boolean;
  appEntryPath?: string;
}

/** Builds the Windows `.cmd` launcher script for `awlasso`. */
export function buildWindowsCmdLauncher(options: LauncherScriptOptions): string {
  const isPackaged = options.isPackaged ?? true;
  const target =
    !isPackaged && options.appEntryPath
      ? `"${options.execPath}" "${options.appEntryPath}"`
      : `"${options.execPath}"`;
  return [
    '@echo off',
    'setlocal',
    'set ELECTRON_RUN_AS_NODE=',
    `start "" /b ${target} %*`,
    'endlocal',
    '',
  ].join('\r\n');
}

/** Escapes single quotes for safe embedding inside a POSIX `sh` single-quoted string. */
function shSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Builds the POSIX `sh` launcher script for `awlasso` (macOS, Linux, and Git Bash on Windows). */
export function buildPosixShellLauncher(options: LauncherScriptOptions): string {
  const isPackaged = options.isPackaged ?? true;
  const execQuoted = shSingleQuote(options.execPath.replace(/\\/g, '/'));
  const launchCmd =
    !isPackaged && options.appEntryPath
      ? `${execQuoted} ${shSingleQuote(options.appEntryPath.replace(/\\/g, '/'))} "$@"`
      : `${execQuoted} "$@"`;
  return [
    '#!/usr/bin/env sh',
    'unset ELECTRON_RUN_AS_NODE',
    `nohup ${launchCmd} >/dev/null 2>&1 &`,
    '',
  ].join('\n');
}

/** Whether installing the `awlasso` CLI command is supported in this environment. */
export function isCliCommandSupported(
  deps: Pick<CliCommandDeps, 'platform' | 'env' | 'homeDir' | 'execPath'>,
): boolean {
  if (!deps.execPath || typeof deps.execPath !== 'string') return false;
  const { primary } = resolveCliInstallPaths(deps);
  return primary !== null;
}

/** Queries whether the `awlasso` CLI launcher is currently installed. */
export async function getCliCommandStatus(deps: CliCommandDeps): Promise<CliCommandStatus> {
  if (!isCliCommandSupported(deps)) {
    return { supported: false, enabled: false, commandPath: null };
  }
  const { primary, candidates } = resolveCliInstallPaths(deps);
  for (const candidate of candidates) {
    try {
      if (deps.exists(candidate)) {
        return { supported: true, enabled: true, commandPath: candidate };
      }
    } catch {
      // Ignore permission errors when probing candidates.
    }
  }
  return { supported: true, enabled: false, commandPath: primary };
}

/** Installs or removes the `awlasso` CLI launcher script. */
export async function setCliCommandEnabled(
  enable: boolean,
  deps: CliCommandDeps,
): Promise<CliCommandUpdateResult> {
  if (!isCliCommandSupported(deps)) {
    return {
      ok: false,
      enabled: false,
      commandPath: null,
      error: `The "${CLI_COMMAND_NAME}" CLI command is not supported in this environment.`,
    };
  }

  const { primary, companionPosix, candidates } = resolveCliInstallPaths(deps);

  if (enable) {
    const scriptOpts: LauncherScriptOptions = {
      execPath: deps.execPath,
      isPackaged: deps.isPackaged,
      appEntryPath: deps.appEntryPath,
    };

    if (deps.platform === 'win32' && primary) {
      try {
        deps.mkdir(dirnamePath('win32', primary));
        deps.writeFile(primary, buildWindowsCmdLauncher(scriptOpts));
        if (companionPosix) {
          deps.writeFile(companionPosix, buildPosixShellLauncher(scriptOpts), 0o755);
        }
        return { ok: true, enabled: true, commandPath: primary };
      } catch (err) {
        return {
          ok: false,
          enabled: false,
          commandPath: primary,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const content = buildPosixShellLauncher(scriptOpts);
    let lastError = 'No writable bin directory found.';
    for (const candidate of candidates) {
      try {
        deps.mkdir(dirnamePath(deps.platform, candidate));
        deps.writeFile(candidate, content, 0o755);
        return { ok: true, enabled: true, commandPath: candidate };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    return {
      ok: false,
      enabled: false,
      commandPath: primary,
      error: lastError,
    };
  }

  try {
    const toRemove = [...candidates, ...(companionPosix ? [companionPosix] : [])];
    for (const target of toRemove) {
      if (deps.exists(target)) {
        deps.unlink(target);
      }
    }
    return { ok: true, enabled: false, commandPath: primary };
  } catch (err) {
    const status = await getCliCommandStatus(deps);
    return {
      ok: !status.enabled,
      enabled: status.enabled,
      commandPath: status.commandPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
