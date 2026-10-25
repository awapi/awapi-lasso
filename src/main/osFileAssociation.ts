export const COLLECTION_EXTENSIONS = ['.awjc', '.awj'] as const;

export const COLLECTION_OPENED_FROM_OS_CHANNEL = 'collection:openedFromOs';

/** The parts of a `BrowserWindow` needed to deliver a message to its renderer. */
export interface DeliverableWindow {
  isDestroyed: () => boolean;
  webContents: {
    isLoading: () => boolean;
    once: (event: 'did-finish-load', listener: () => void) => unknown;
    send: (channel: string, ...args: unknown[]) => void;
  };
}

export interface OsFileArgDeps {
  platform: NodeJS.Platform;
  /** Whether a file (not a directory) exists at `p`. */
  isFile: (p: string) => boolean;
}

function sep(platform: NodeJS.Platform): string {
  return platform === 'win32' ? '\\' : '/';
}

function isAbsolutePath(platform: NodeJS.Platform, p: string): boolean {
  return platform === 'win32' ? /^([a-zA-Z]:[\\/]|\\\\)/.test(p) : p.startsWith('/');
}

/** Resolves a potentially relative path against `cwd` without importing `path`. */
export function resolveCollectionPathFromCwd(
  platform: NodeJS.Platform,
  cwd: string,
  target: string,
): string {
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
 * Returns true if `filePath` has a `.awjc` or `.awj` extension (case-insensitive).
 */
export function isCollectionFilePath(filePath: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const trimmed = filePath.trim().toLowerCase();
  return COLLECTION_EXTENSIONS.some(ext => trimmed.endsWith(ext));
}

/**
 * Extracts `.awjc` and `.awj` collection file paths from an Electron `argv` array
 * (`process.argv` or `second-instance` commandLine), resolving relative paths against
 * `workingDirectory` and checking `deps.isFile`.
 */
export function extractCollectionPathsFromArgv(
  argv: string[],
  isDev: boolean,
  workingDirectory: string,
  deps: OsFileArgDeps,
): string[] {
  const candidates = argv.slice(isDev ? 2 : 1);
  const files: string[] = [];
  const seen = new Set<string>();
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
        ? resolveCollectionPathFromCwd(deps.platform, workingDirectory, arg)
        : arg;

    if (!isCollectionFilePath(resolved)) continue;
    if (!deps.isFile(resolved)) continue;

    const key = deps.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) {
      seen.add(key);
      files.push(resolved);
    }
  }

  return files;
}

/**
 * Returns `current` if it is still open, otherwise a window from `create()`.
 */
export function ensureWindow<T extends DeliverableWindow>(
  current: T | null | undefined,
  create: () => T,
): T {
  return current && !current.isDestroyed() ? current : create();
}

/**
 * Sends `channel` to the window's renderer, waiting for the page to finish
 * loading first if needed. Dropped if the window is destroyed in the meantime.
 */
export function sendWhenLoaded(win: DeliverableWindow, channel: string, ...args: unknown[]): void {
  const send = () => {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  };
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send);
  } else {
    send();
  }
}

export interface OsFileQueueOptions<T extends DeliverableWindow = DeliverableWindow> {
  isAppReady: () => boolean;
  getMainWindow: () => T | null;
  createMainWindow: () => T;
  onFileDelivered?: (filePath: string) => void;
  channel?: string;
}

export interface OsFileQueue {
  /** Queue or immediately deliver one or more `.awjc` / `.awj` file paths. */
  enqueue: (filePaths: string | string[]) => void;
  /** Flush all queued cold-start file paths to the main window once ready. */
  flush: () => string[];
  /** Inspect currently pending cold-start paths (primarily for testing/diagnostics). */
  getPending: () => string[];
}

/**
 * Creates a coordinator that queues `.awjc` / `.awj` file paths received during
 * cold start (via `process.argv` or macOS `open-file` before `app.whenReady()`)
 * and delivers them over IPC (`collection:openedFromOs`) once `mainWindow` is ready.
 */
export function createOsFileQueue<T extends DeliverableWindow = DeliverableWindow>(
  options: OsFileQueueOptions<T>,
): OsFileQueue {
  const channel = options.channel ?? COLLECTION_OPENED_FROM_OS_CHANNEL;
  const pending: string[] = [];

  const deliverSingle = (win: T, filePath: string) => {
    options.onFileDelivered?.(filePath);
    sendWhenLoaded(win, channel, filePath);
  };

  const enqueue = (input: string | string[]) => {
    const list = Array.isArray(input) ? input : [input];
    const valid = list.filter(p => isCollectionFilePath(p));
    if (valid.length === 0) return;

    if (!options.isAppReady()) {
      for (const filePath of valid) {
        if (!pending.includes(filePath)) {
          pending.push(filePath);
        }
      }
      return;
    }

    const win = ensureWindow(options.getMainWindow(), options.createMainWindow);
    for (const filePath of valid) {
      deliverSingle(win, filePath);
    }
  };

  const flush = (): string[] => {
    if (pending.length === 0 || !options.isAppReady()) {
      return [];
    }
    const toDeliver = pending.splice(0, pending.length);
    const win = ensureWindow(options.getMainWindow(), options.createMainWindow);
    for (const filePath of toDeliver) {
      deliverSingle(win, filePath);
    }
    return toDeliver;
  };

  return {
    enqueue,
    flush,
    getPending: () => [...pending],
  };
}
