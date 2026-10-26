import type { PtyCreateOptions, PtyCreateResult, PtyDataEvent, PtyExitEvent } from '../shared/terminal';
import type { ShellSpec } from './terminalDetection';
import { sanitizeTerminalEnv } from './externalTerminal';

/** Subset of node-pty's IPty used by the manager. */
export interface PtyProcess {
  onData: (listener: (data: string) => void) => unknown;
  onExit: (listener: (e: { exitCode: number; signal?: number }) => void) => unknown;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

export interface PtySpawnOptions {
  name: string;
  cols: number;
  rows: number;
  cwd: string;
  env: Record<string, string>;
}

export type SpawnPty = (file: string, args: string[], options: PtySpawnOptions) => PtyProcess;

export interface PtyManagerDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  /** Loads node-pty lazily so a missing/broken native module only disables the terminal. */
  loadSpawnPty: () => Promise<SpawnPty>;
  /** Resolves the shell from the user's current settings (null = configured shell not found). */
  resolveShell: () => ShellSpec | null;
  /** Resolves a file/folder to the folder to start in; falls back to the home folder. */
  resolveCwd: (target: string | null) => string;
  sendData: (ownerId: number, event: PtyDataEvent) => void;
  sendExit: (ownerId: number, event: PtyExitEvent) => void;
  /** Output is coalesced for this long before being sent to the renderer. */
  flushDelayMs?: number;
}

interface Session {
  ownerId: number;
  pty: PtyProcess;
  buffer: string;
  timer: ReturnType<typeof setTimeout> | null;
}

const MIN_DIMENSION = 1;
const MAX_DIMENSION = 1000;

export function clampDimension(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.floor(value)));
}

/** Builds the environment for an integrated-terminal shell. */
export function buildPtyEnv(
  baseEnv: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  shellEnv: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(sanitizeTerminalEnv(baseEnv))) {
    if (typeof value === 'string') env[key] = value;
  }
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'AwapiLasso';
  // Apps launched from Finder have no LANG; without it shells mangle UTF-8.
  if (platform === 'darwin' && !env.LANG) env.LANG = 'en_US.UTF-8';
  return { ...env, ...shellEnv };
}

/**
 * Owns all integrated-terminal processes. Each session belongs to the window
 * (webContents id) that created it; other windows cannot write to, resize, or
 * kill it.
 */
export class PtyManager {
  private readonly sessions = new Map<number, Session>();
  private nextId = 1;

  constructor(private readonly deps: PtyManagerDeps) {}

  get size(): number {
    return this.sessions.size;
  }

  async create(ownerId: number, options: Partial<PtyCreateOptions> | undefined): Promise<PtyCreateResult> {
    const shell = this.deps.resolveShell();
    if (!shell) {
      return { ok: false, error: 'The configured shell was not found. Check the Integrated Terminal setting in Preferences.' };
    }
    let spawnPty: SpawnPty;
    try {
      spawnPty = await this.deps.loadSpawnPty();
    } catch (err) {
      return { ok: false, error: `The integrated terminal is unavailable: ${(err as Error).message}` };
    }

    const target = typeof options?.cwd === 'string' && options.cwd ? options.cwd : null;
    const cwd = this.deps.resolveCwd(target);
    let pty: PtyProcess;
    try {
      pty = spawnPty(shell.file, shell.args, {
        name: 'xterm-256color',
        cols: clampDimension(options?.cols, 80),
        rows: clampDimension(options?.rows, 24),
        cwd,
        env: buildPtyEnv(this.deps.env, this.deps.platform, shell.env),
      });
    } catch (err) {
      return { ok: false, error: `Could not start ${shell.label}: ${(err as Error).message}` };
    }

    const id = this.nextId++;
    const session: Session = { ownerId, pty, buffer: '', timer: null };
    this.sessions.set(id, session);
    pty.onData(data => this.queueData(id, session, data));
    pty.onExit(({ exitCode }) => {
      if (this.sessions.get(id) !== session) return;
      this.flush(id, session);
      this.sessions.delete(id);
      this.deps.sendExit(ownerId, { id, exitCode });
    });
    return { ok: true, id, cwd, shell: shell.label };
  }

  write(ownerId: number, id: number, data: unknown): void {
    if (typeof data !== 'string') return;
    this.owned(ownerId, id)?.pty.write(data);
  }

  resize(ownerId: number, id: number, cols: unknown, rows: unknown): void {
    const session = this.owned(ownerId, id);
    if (!session) return;
    try {
      session.pty.resize(clampDimension(cols, 80), clampDimension(rows, 24));
    } catch {
      // The process may have exited between the check and the resize.
    }
  }

  kill(ownerId: number, id: number): void {
    const session = this.owned(ownerId, id);
    if (session) this.dispose(id, session);
  }

  /** Kills every session owned by a window (e.g. when it closes). */
  killAllForOwner(ownerId: number): void {
    for (const [id, session] of [...this.sessions]) {
      if (session.ownerId === ownerId) this.dispose(id, session);
    }
  }

  killAll(): void {
    for (const [id, session] of [...this.sessions]) this.dispose(id, session);
  }

  private owned(ownerId: number, id: number): Session | undefined {
    const session = this.sessions.get(id);
    return session && session.ownerId === ownerId ? session : undefined;
  }

  private dispose(id: number, session: Session): void {
    if (session.timer) clearTimeout(session.timer);
    this.sessions.delete(id);
    try {
      session.pty.kill();
    } catch {
      // Already exited.
    }
  }

  private queueData(id: number, session: Session, data: string): void {
    if (this.sessions.get(id) !== session) return;
    session.buffer += data;
    if (!session.timer) {
      session.timer = setTimeout(() => this.flush(id, session), this.deps.flushDelayMs ?? 5);
    }
  }

  private flush(id: number, session: Session): void {
    if (session.timer) clearTimeout(session.timer);
    session.timer = null;
    if (!session.buffer) return;
    const data = session.buffer;
    session.buffer = '';
    this.deps.sendData(session.ownerId, { id, data });
  }
}
