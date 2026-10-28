import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  },
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

describe('AI assistant bridge', () => {
  it.each([
    ['aiGetSettings', 'ai:getSettings', []],
    ['aiSaveSettings', 'ai:saveSettings', [{ provider: 'anthropic' }]],
    ['aiGetKeyStatuses', 'ai:getKeyStatuses', []],
    ['aiSetKey', 'ai:setKey', ['openai', 'sk-test']],
    ['aiClearKey', 'ai:clearKey', ['openai']],
    ['aiTestConnection', 'ai:testConnection', []],
    ['aiListModels', 'ai:listModels', []],
    ['aiSend', 'ai:send', [{ turnId: 't', messages: [] }]],
    ['aiCancel', 'ai:cancel', ['t']],
    ['aiToolResult', 'ai:toolResult', ['t::c', { ok: true, content: '{}' }]],
  ] as const)('%s invokes %s', async (method, channel, args) => {
    await (electronAPI[method] as (...a: unknown[]) => Promise<unknown>)(...args);
    expect(ipcRenderer.invoke).toHaveBeenLastCalledWith(channel, ...args);
  });

  it('subscribes to streamed AI events and unsubscribes', () => {
    const callback = vi.fn();
    const unsubscribe = electronAPI.onAiEvent(callback);
    const [channel, listener] = vi.mocked(ipcRenderer.on).mock.calls.at(-1) as [
      string,
      (e: unknown, payload: unknown) => void,
    ];
    expect(channel).toBe('ai:event');
    const payload = { turnId: 't', event: { type: 'done' } };
    listener({}, payload);
    expect(callback).toHaveBeenCalledWith(payload);
    unsubscribe();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('ai:event', listener);
  });

  it('never exposes a method that reads plaintext API keys', () => {
    expect(Object.keys(electronAPI).filter(k => /^ai/.test(k) && /get.*key$/i.test(k))).toEqual([]);
  });
});
