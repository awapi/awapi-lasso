import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { folderName, useTerminalSessions, type TerminalApi } from './useTerminalSessions';
import type { PtyCreateResult, PtyDataEvent, PtyExitEvent } from '../../shared/terminal';

function createApi() {
  let dataListener: ((e: PtyDataEvent) => void) | null = null;
  let exitListener: ((e: PtyExitEvent) => void) | null = null;
  let nextId = 1;
  const api = {
    ptyCreate: vi.fn(async ({ cwd }: { cwd: string | null }): Promise<PtyCreateResult> => ({
      ok: true,
      id: nextId++,
      cwd: cwd ? '/proj' : '/home/me',
      shell: 'bash',
    })),
    ptyKill: vi.fn(async () => {}),
    onPtyData: vi.fn((cb: (e: PtyDataEvent) => void) => {
      dataListener = cb;
      return () => { dataListener = null; };
    }),
    onPtyExit: vi.fn((cb: (e: PtyExitEvent) => void) => {
      exitListener = cb;
      return () => { exitListener = null; };
    }),
  } satisfies TerminalApi;
  return {
    api,
    emitData: (id: number, data: string) => act(() => dataListener?.({ id, data })),
    emitExit: (id: number, exitCode: number) => act(() => exitListener?.({ id, exitCode })),
    isSubscribed: () => dataListener !== null && exitListener !== null,
  };
}

describe('folderName', () => {
  it('returns the last path segment for POSIX and Windows paths', () => {
    expect(folderName('/Users/me/project')).toBe('project');
    expect(folderName('C:\\work\\repo\\')).toBe('repo');
    expect(folderName('/')).toBe('/');
  });
});

describe('useTerminalSessions', () => {
  it('reports unavailability without an API', () => {
    const { result } = renderHook(() => useTerminalSessions(null));
    expect(result.current.isAvailable).toBe(false);
  });

  it('creates sessions, opens the panel, and activates the newest', async () => {
    const { api } = createApi();
    const { result } = renderHook(() => useTerminalSessions(api));

    await act(() => result.current.createSession('/proj/a.awjc'));
    await act(() => result.current.createSession(null));

    expect(api.ptyCreate).toHaveBeenNthCalledWith(1, { cwd: '/proj/a.awjc', cols: 80, rows: 24 });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.sessions.map(s => s.title)).toEqual(['bash — proj', 'bash — me']);
    expect(result.current.activeId).toBe(2);
  });

  it('shows an error when the shell cannot start', async () => {
    const { api } = createApi();
    api.ptyCreate.mockResolvedValueOnce({ ok: false, error: 'boom' });
    const { result } = renderHook(() => useTerminalSessions(api));

    await act(() => result.current.createSession(null));
    expect(result.current.error).toBe('boom');
    expect(result.current.isOpen).toBe(true);
    expect(result.current.sessions).toEqual([]);

    await act(() => result.current.createSession(null));
    expect(result.current.error).toBeNull();
  });

  it('togglePanel starts a shell only when there are no sessions', async () => {
    const { api } = createApi();
    const { result } = renderHook(() => useTerminalSessions(api));

    await act(async () => result.current.togglePanel('/proj/a.awjc'));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.togglePanel('/x'));
    expect(result.current.isOpen).toBe(false);
    act(() => result.current.togglePanel('/x'));
    expect(result.current.isOpen).toBe(true);
    expect(api.ptyCreate).toHaveBeenCalledTimes(1);

    act(() => result.current.hidePanel());
    expect(result.current.isOpen).toBe(false);
  });

  it('routes output to subscribed writers and buffers output that arrives before subscription', async () => {
    const { api, emitData } = createApi();
    const { result } = renderHook(() => useTerminalSessions(api));
    await act(() => result.current.createSession(null));

    emitData(1, 'hello ');
    emitData(1, 'world');
    const writer = vi.fn();
    let unsubscribe = () => {};
    act(() => { unsubscribe = result.current.subscribe(1, writer); });
    expect(writer).toHaveBeenCalledWith('hello world');

    emitData(1, '!');
    expect(writer).toHaveBeenLastCalledWith('!');

    unsubscribe();
    emitData(1, 'later');
    expect(writer).toHaveBeenCalledTimes(2);
  });

  it('removes a session that exits cleanly and activates a neighbour', async () => {
    const { api, emitExit } = createApi();
    const { result } = renderHook(() => useTerminalSessions(api));
    await act(() => result.current.createSession(null));
    await act(() => result.current.createSession(null));

    emitExit(2, 0);
    expect(result.current.sessions.map(s => s.id)).toEqual([1]);
    expect(result.current.activeId).toBe(1);

    emitExit(1, 0);
    expect(result.current.sessions).toEqual([]);
    expect(result.current.activeId).toBeNull();
    expect(result.current.isOpen).toBe(false);
  });

  it('keeps a session that exits with an error and prints the exit code', async () => {
    const { api, emitExit } = createApi();
    const { result } = renderHook(() => useTerminalSessions(api));
    await act(() => result.current.createSession(null));
    const writer = vi.fn();
    act(() => { result.current.subscribe(1, writer); });

    emitExit(1, 127);
    expect(result.current.sessions[0].exitCode).toBe(127);
    expect(writer).toHaveBeenCalledWith(expect.stringContaining('Process exited with code 127'));
  });

  it('closeSession kills the shell and hides the panel when the last one closes', async () => {
    const { api } = createApi();
    const { result } = renderHook(() => useTerminalSessions(api));
    await act(() => result.current.createSession(null));
    await act(() => result.current.createSession(null));

    act(() => result.current.setActiveId(1));
    act(() => result.current.closeSession(1));
    expect(api.ptyKill).toHaveBeenCalledWith(1);
    expect(result.current.activeId).toBe(2);
    expect(result.current.isOpen).toBe(true);

    act(() => result.current.closeSession(2));
    expect(result.current.isOpen).toBe(false);
  });

  it('unsubscribes from pty events on unmount', () => {
    const { api, isSubscribed } = createApi();
    const { unmount } = renderHook(() => useTerminalSessions(api));
    expect(isSubscribed()).toBe(true);
    unmount();
    expect(isSubscribed()).toBe(false);
  });
});
