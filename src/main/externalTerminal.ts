import type { SpawnOptions } from 'child_process';
import type { TerminalPreference } from '../shared/terminal';
import { resolveExternalTerminals, type DetectionDeps, type ExternalTerminalSpec } from './terminalDetection';

// This module only uses `import type` from Node built-ins: all OS access is
// injected via `ExternalTerminalDeps` (wired up in main.ts) so the logic can
// be unit tested in the renderer-configured Vitest environment.

export type OpenTerminalResult =
  | { ok: true; cwd: string; command: string }
  | { ok: false; error: string };

/** Minimal subset of ChildProcess used by the launcher (simplifies mocking). */
export interface SpawnedProcess {
  once: (event: 'spawn' | 'error', listener: (err?: Error) => void) => unknown;
  unref: () => void;
}

export interface ExternalTerminalDeps extends DetectionDeps {
  spawn: (command: string, args: string[], options: SpawnOptions) => SpawnedProcess;
  /** Returns whether `p` is an existing directory. */
  isDirectory: (p: string) => boolean;
  /** Platform-native `path.dirname` / `path.isAbsolute`. */
  dirname: (p: string) => string;
  isAbsolute: (p: string) => boolean;
  /** Where terminals open when there is no file (e.g. unsaved collections). */
  homeDir: string;
}

/** Environment variables that must not leak from Electron/Vite into the user's shell. */
const STRIPPED_ENV_KEYS = new Set(['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE', 'NODE_ENV']);

export function sanitizeTerminalEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (STRIPPED_ENV_KEYS.has(key) || key.startsWith('VITE_')) continue;
    result[key] = value;
  }
  return result;
}

/**
 * Resolves the directory a terminal should open in for `targetPath`.
 * Accepts either a file path (its parent directory is used) or a directory.
 * Returns null when the path is invalid or the directory does not exist.
 */
export function resolveTerminalCwd(
  targetPath: unknown,
  deps: Pick<ExternalTerminalDeps, 'platform' | 'isDirectory' | 'dirname' | 'isAbsolute'>,
): string | null {
  const { platform, isDirectory, dirname, isAbsolute } = deps;
  if (typeof targetPath !== 'string' || !targetPath || !isAbsolute(targetPath)) return null;
  let cwd: string | null = null;
  if (isDirectory(targetPath)) cwd = targetPath;
  else if (isDirectory(dirname(targetPath))) cwd = dirname(targetPath);
  if (cwd && platform === 'win32' && /^[a-z]:/.test(cwd)) {
    // Lower-case drive letters confuse some Windows shells.
    cwd = cwd[0].toUpperCase() + cwd.slice(1);
  }
  return cwd;
}

function trySpawn(
  spec: ExternalTerminalSpec,
  cwd: string,
  env: NodeJS.ProcessEnv,
  deps: ExternalTerminalDeps,
): Promise<boolean> {
  return new Promise(resolve => {
    let child: SpawnedProcess;
    try {
      child = deps.spawn(spec.command, spec.args(cwd), {
        cwd,
        env,
        detached: true,
        stdio: 'ignore',
        // Windows args are pre-quoted for `cmd /c start "" ...`.
        windowsVerbatimArguments: deps.platform === 'win32',
      });
    } catch {
      resolve(false);
      return;
    }
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
    child.once('error', () => resolve(false));
  });
}

/**
 * Opens a terminal application in the directory containing `targetPath` (or
 * in `targetPath` itself if it is a directory, or in the home folder when it
 * is null/empty, e.g. for unsaved collections). `preference` is the user's
 * Preferences choice (null = automatic). In automatic mode it falls back
 * through the detected terminals when one fails to start.
 */
export async function openExternalTerminal(
  targetPath: unknown,
  deps: ExternalTerminalDeps,
  preference: TerminalPreference = null,
): Promise<OpenTerminalResult> {
  const target = typeof targetPath === 'string' && targetPath ? targetPath : deps.homeDir;
  const cwd = resolveTerminalCwd(target, deps);
  if (!cwd) return { ok: false, error: 'The folder for this file does not exist.' };

  const env = sanitizeTerminalEnv(deps.env);
  const candidates = resolveExternalTerminals(preference, deps);
  for (const spec of candidates) {
    if (await trySpawn(spec, cwd, env, deps)) {
      return { ok: true, cwd, command: spec.command };
    }
  }
  return {
    ok: false,
    error: preference
      ? `Could not start "${candidates[0]?.label ?? preference}". Check the External Terminal setting in Preferences.`
      : 'No supported terminal application was found.',
  };
}
