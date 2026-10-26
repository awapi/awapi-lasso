import { useCallback, useEffect, useRef, useState } from 'react';
import type { PtyCreateOptions, PtyCreateResult, PtyDataEvent, PtyExitEvent } from '../../shared/terminal';

/** The subset of `window.electronAPI` the integrated terminal needs. */
export interface TerminalApi {
  ptyCreate: (options: PtyCreateOptions) => Promise<PtyCreateResult>;
  ptyKill: (id: number) => Promise<void>;
  onPtyData: (callback: (event: PtyDataEvent) => void) => () => void;
  onPtyExit: (callback: (event: PtyExitEvent) => void) => () => void;
}

export interface TerminalSession {
  id: number;
  title: string;
  cwd: string;
  /** Set when the shell exited with a non-zero code (the session stays open to show output). */
  exitCode?: number;
}

export type TerminalWriter = (data: string) => void;

function getDefaultApi(): TerminalApi | null {
  const api = (window as unknown as { electronAPI?: Partial<TerminalApi> }).electronAPI;
  return api?.ptyCreate && api.ptyKill && api.onPtyData && api.onPtyExit ? (api as TerminalApi) : null;
}

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Manages the integrated terminal panel: open/hidden state, the list of shell
 * sessions, and routing shell output to each session's xterm view (buffering
 * output that arrives before the view has mounted).
 */
export function useTerminalSessions(api: TerminalApi | null = getDefaultApi()) {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const writers = useRef(new Map<number, TerminalWriter>());
  const pending = useRef(new Map<number, string>());
  // Source of truth for event handlers that may run before React re-renders.
  const sessionsRef = useRef<TerminalSession[]>([]);

  const commit = useCallback((next: TerminalSession[]) => {
    sessionsRef.current = next;
    setSessions(next);
  }, []);

  const write = useCallback((id: number, data: string) => {
    const writer = writers.current.get(id);
    if (writer) writer(data);
    else pending.current.set(id, (pending.current.get(id) ?? '') + data);
  }, []);

  const removeSession = useCallback((id: number) => {
    writers.current.delete(id);
    pending.current.delete(id);
    const prev = sessionsRef.current;
    const index = prev.findIndex(s => s.id === id);
    if (index === -1) return;
    const next = prev.filter(s => s.id !== id);
    commit(next);
    setActiveId(current => (current === id ? (next[Math.min(index, next.length - 1)]?.id ?? null) : current));
    if (next.length === 0) setIsOpen(false);
  }, [commit]);

  useEffect(() => {
    if (!api) return;
    const offData = api.onPtyData(({ id, data }) => write(id, data));
    const offExit = api.onPtyExit(({ id, exitCode }) => {
      if (exitCode === 0) {
        removeSession(id);
        return;
      }
      write(id, `\r\n\x1b[2m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      commit(sessionsRef.current.map(s => (s.id === id ? { ...s, exitCode } : s)));
    });
    return () => {
      offData();
      offExit();
    };
  }, [api, write, removeSession, commit]);

  /** Starts a new shell in the folder of `cwd` (a file or folder; null = home) and shows the panel. */
  const createSession = useCallback(async (cwd: string | null) => {
    if (!api) return;
    setIsOpen(true);
    const result = await api.ptyCreate({ cwd, cols: 80, rows: 24 });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    const session: TerminalSession = {
      id: result.id,
      title: `${result.shell} — ${folderName(result.cwd)}`,
      cwd: result.cwd,
    };
    commit([...sessionsRef.current, session]);
    setActiveId(result.id);
  }, [api, commit]);

  const closeSession = useCallback((id: number) => {
    void api?.ptyKill(id);
    removeSession(id);
  }, [api, removeSession]);

  /** Shows/hides the panel; showing an empty panel starts a shell in `cwdForNew`. */
  const togglePanel = useCallback((cwdForNew: string | null) => {
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (sessionsRef.current.length === 0) void createSession(cwdForNew);
    else setIsOpen(true);
  }, [isOpen, createSession]);

  const hidePanel = useCallback(() => setIsOpen(false), []);

  /** Registers the xterm writer for a session and flushes output received before it mounted. */
  const subscribe = useCallback((id: number, writer: TerminalWriter) => {
    writers.current.set(id, writer);
    const buffered = pending.current.get(id);
    if (buffered) {
      pending.current.delete(id);
      writer(buffered);
    }
    return () => {
      if (writers.current.get(id) === writer) writers.current.delete(id);
    };
  }, []);

  return {
    isAvailable: api !== null,
    sessions,
    activeId,
    isOpen,
    error,
    setActiveId,
    createSession,
    closeSession,
    togglePanel,
    hidePanel,
    subscribe,
  };
}

export type TerminalSessionsController = ReturnType<typeof useTerminalSessions>;
