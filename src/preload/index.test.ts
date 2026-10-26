import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn().mockResolvedValue(undefined) },
  webUtils: {},
}));

import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from './index';

describe('application information bridge', () => {
  it('exposes the typed API to the renderer', async () => {
    vi.resetModules();
    const preload = await import('./index');
    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith('electronAPI', preload.electronAPI);
  });

  it.each([
    ['checkForUpdates', 'updater:check'],
  ] as const)('invokes the %s channel', async (method, channel) => {
    await expect(electronAPI[method]()).resolves.toBeUndefined();
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(channel);
  });
});
