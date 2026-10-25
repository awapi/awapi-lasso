// This module avoids runtime Node built-in imports so it can be unit-tested
// directly in the renderer-configured Vitest environment. All OS access is
// injected via `ContextMenuDeps` from `main.ts`.

export const CONTEXT_MENU_KEY = 'HKCU\\Software\\Classes\\*\\shell\\AwapiLasso';
export const CONTEXT_MENU_COMMAND_KEY = `${CONTEXT_MENU_KEY}\\command`;
export const CONTEXT_MENU_DIR_KEY = 'HKCU\\Software\\Classes\\Directory\\shell\\AwapiLasso';
export const CONTEXT_MENU_DIR_COMMAND_KEY = `${CONTEXT_MENU_DIR_KEY}\\command`;
export const CONTEXT_MENU_DIR_BG_KEY = 'HKCU\\Software\\Classes\\Directory\\Background\\shell\\AwapiLasso';
export const CONTEXT_MENU_DIR_BG_COMMAND_KEY = `${CONTEXT_MENU_DIR_BG_KEY}\\command`;
export const CONTEXT_MENU_LABEL = 'Open with AwapiLasso';

export interface ContextMenuStatus {
  /** True on Windows (`win32`) when packaged or an executable path is available. */
  supported: boolean;
  /** True when the Explorer context menu registry entry is currently registered. */
  enabled: boolean;
}

export type ContextMenuUpdateResult =
  | { ok: true; enabled: boolean }
  | { ok: false; enabled: boolean; error: string };

export interface ContextMenuDeps {
  platform: NodeJS.Platform;
  /** Full path to `AwapiLasso.exe` (or `process.execPath` in dev). */
  execPath: string;
  /** False in `vite` dev mode where `execPath` is `electron.exe` rather than the packaged app. */
  isPackaged: boolean;
  /** Optional path to `build/icon.ico` used when not packaged (so dev builds show the real icon instead of Electron's). */
  iconPath?: string;
  /** Optional path to the app entry script (`dist/main/main.js`) used in dev mode so `electron.exe` launches the app. */
  appEntryPath?: string;
  /** Runs `reg.exe` with the given arguments and resolves with exit code + output. */
  runReg: (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;
}

/** Builds the `reg.exe` arguments to query whether the context menu command is registered. */
export function buildQueryArgs(): string[] {
  return ['query', CONTEXT_MENU_COMMAND_KEY, '/ve'];
}

/** Builds the sequence of `reg.exe` queries verifying both file and folder context menus. */
export function buildQueryCommands(): string[][] {
  return [
    ['query', CONTEXT_MENU_COMMAND_KEY, '/ve'],
    ['query', CONTEXT_MENU_DIR_COMMAND_KEY, '/ve'],
    ['query', CONTEXT_MENU_DIR_BG_COMMAND_KEY, '/ve'],
  ];
}

export interface RegisterCommandOptions {
  execPath: string;
  isPackaged?: boolean;
  iconPath?: string;
  appEntryPath?: string;
}

/**
 * Builds the sequence of `reg.exe` invocations that register "Open with AwapiLasso"
 * under `HKCU\Software\Classes\*\shell\AwapiLasso`,
 * `HKCU\Software\Classes\Directory\shell\AwapiLasso`, and
 * `HKCU\Software\Classes\Directory\Background\shell\AwapiLasso`.
 */
export function buildRegisterCommands(
  input: string | RegisterCommandOptions,
): string[][] {
  const opts: RegisterCommandOptions =
    typeof input === 'string' ? { execPath: input, isPackaged: true } : input;
  const isPackaged = opts.isPackaged ?? true;
  const iconValue =
    !isPackaged && opts.iconPath
      ? `"${opts.iconPath}"`
      : `"${opts.execPath}",0`;
  const commandValue =
    !isPackaged && opts.appEntryPath
      ? `"${opts.execPath}" "${opts.appEntryPath}" "%1"`
      : `"${opts.execPath}" "%1"`;
  const bgCommandValue =
    !isPackaged && opts.appEntryPath
      ? `"${opts.execPath}" "${opts.appEntryPath}" "%V"`
      : `"${opts.execPath}" "%V"`;

  return [
    ['add', CONTEXT_MENU_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
    ['add', CONTEXT_MENU_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', iconValue, '/f'],
    ['add', CONTEXT_MENU_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', commandValue, '/f'],
    ['add', CONTEXT_MENU_DIR_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
    ['add', CONTEXT_MENU_DIR_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', iconValue, '/f'],
    ['add', CONTEXT_MENU_DIR_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', commandValue, '/f'],
    ['add', CONTEXT_MENU_DIR_BG_KEY, '/ve', '/t', 'REG_SZ', '/d', CONTEXT_MENU_LABEL, '/f'],
    ['add', CONTEXT_MENU_DIR_BG_KEY, '/v', 'Icon', '/t', 'REG_SZ', '/d', iconValue, '/f'],
    ['add', CONTEXT_MENU_DIR_BG_COMMAND_KEY, '/ve', '/t', 'REG_SZ', '/d', bgCommandValue, '/f'],
  ];
}

/** Builds the `reg.exe` arguments to remove the file context menu registry key tree. */
export function buildUnregisterArgs(): string[] {
  return ['delete', CONTEXT_MENU_KEY, '/f'];
}

/** Builds the sequence of `reg.exe` invocations to remove all context menu registry keys. */
export function buildUnregisterCommands(): string[][] {
  return [
    ['delete', CONTEXT_MENU_KEY, '/f'],
    ['delete', CONTEXT_MENU_DIR_KEY, '/f'],
    ['delete', CONTEXT_MENU_DIR_BG_KEY, '/f'],
  ];
}

/** Whether Windows Explorer context menu registration is supported in this environment. */
export function isContextMenuSupported(deps: Pick<ContextMenuDeps, 'platform' | 'execPath'>): boolean {
  return deps.platform === 'win32' && typeof deps.execPath === 'string' && deps.execPath.length > 0;
}

/** Queries the current Windows Explorer context menu registration status. */
export async function getContextMenuStatus(deps: ContextMenuDeps): Promise<ContextMenuStatus> {
  if (!isContextMenuSupported(deps)) {
    return { supported: false, enabled: false };
  }
  try {
    for (const args of buildQueryCommands()) {
      const res = await deps.runReg(args);
      if (res.code !== 0) {
        return { supported: true, enabled: false };
      }
    }
    return {
      supported: true,
      enabled: true,
    };
  } catch {
    return { supported: true, enabled: false };
  }
}

/** Enables or disables the "Open with AwapiLasso" Windows Explorer context menu entry. */
export async function setContextMenuEnabled(
  enable: boolean,
  deps: ContextMenuDeps,
): Promise<ContextMenuUpdateResult> {
  if (!isContextMenuSupported(deps)) {
    return {
      ok: false,
      enabled: false,
      error: 'Windows Explorer context menu integration is only available on Windows.',
    };
  }

  try {
    if (enable) {
      for (const args of buildRegisterCommands({
        execPath: deps.execPath,
        isPackaged: deps.isPackaged,
        iconPath: deps.iconPath,
        appEntryPath: deps.appEntryPath,
      })) {
        const res = await deps.runReg(args);
        if (res.code !== 0) {
          return {
            ok: false,
            enabled: false,
            error: res.stderr.trim() || res.stdout.trim() || `reg.exe exited with code ${res.code}`,
          };
        }
      }
      return { ok: true, enabled: true };
    } else {
      let lastFailure: { code: number; stdout: string; stderr: string } | null = null;
      for (const args of buildUnregisterCommands()) {
        const res = await deps.runReg(args);
        if (res.code !== 0) {
          lastFailure = res;
        }
      }
      if (lastFailure) {
        let anyPresent = false;
        for (const queryArgs of buildQueryCommands()) {
          const check = await deps.runReg(queryArgs);
          if (check.code === 0) {
            anyPresent = true;
            break;
          }
        }
        if (!anyPresent) {
          return { ok: true, enabled: false };
        }
        return {
          ok: false,
          enabled: true,
          error:
            lastFailure.stderr.trim() ||
            lastFailure.stdout.trim() ||
            `reg.exe exited with code ${lastFailure.code}`,
        };
      }
      return { ok: true, enabled: false };
    }
  } catch (err) {
    return {
      ok: false,
      enabled: !enable,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
