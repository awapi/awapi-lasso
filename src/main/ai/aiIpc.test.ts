import { describe, expect, it, vi } from 'vitest';
import type { AiSendRequest } from '../../shared/aiTypes';
import type { SecretStoreDeps } from '../secretStore';
import { AI_EVENT_CHANNEL, registerAiIpc, type AiIpcMainLike } from './aiIpc';
import type { AiSettingsFsDeps } from './aiSettingsStore';

function setup(encryptionAvailable = true) {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/userdata']);
  const secretDeps: SecretStoreDeps = {
    userDataDir: '/userdata',
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: p => Buffer.from(`cipher:${p}`, 'utf-8'),
    decryptString: b => b.toString('utf-8').slice('cipher:'.length),
    exists: p => files.has(p) || dirs.has(p),
    readFile: p => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFile: (p, c) => void files.set(p, c),
    mkdir: p => void dirs.add(p),
  };
  const fsDeps: AiSettingsFsDeps = { ...secretDeps, joinPath: (...p) => p.join('/') };
  const handlers = new Map<string, (event: unknown, ...args: any[]) => unknown>();
  const ipc: AiIpcMainLike = { handle: (channel, listener) => void handlers.set(channel, listener) };
  const sendEvent = vi.fn();
  registerAiIpc(ipc, { fsDeps, secretDeps, sendEvent });
  const call = <T>(channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args) as T;
  return { call, handlers, sendEvent, files };
}

describe('registerAiIpc', () => {
  it('registers every ai channel', () => {
    const { handlers } = setup();
    expect([...handlers.keys()].sort()).toEqual(
      [
        'ai:cancel',
        'ai:clearKey',
        'ai:getKeyStatuses',
        'ai:getSettings',
        'ai:saveSettings',
        'ai:send',
        'ai:setKey',
        'ai:testConnection',
        'ai:toolResult',
      ].sort(),
    );
    expect(AI_EVENT_CHANNEL).toBe('ai:event');
  });

  it('saves and returns settings', () => {
    const { call } = setup();
    const saved = call<{ provider: string }>('ai:saveSettings', { provider: 'anthropic' });
    expect(saved.provider).toBe('anthropic');
    expect(call<{ provider: string }>('ai:getSettings').provider).toBe('anthropic');
    expect(call<{ provider: string }>('ai:saveSettings', null).provider).toBe('anthropic');
  });

  it('stores keys write-only and reports only booleans', () => {
    const { call, files } = setup();
    expect(call('ai:setKey', 'openai', 'sk-secret-1')).toEqual({ ok: true });
    const statuses = call<Array<{ provider: string; hasKey: boolean }>>('ai:getKeyStatuses');
    expect(statuses.find(s => s.provider === 'openai')?.hasKey).toBe(true);
    expect(statuses.find(s => s.provider === 'anthropic')?.hasKey).toBe(false);
    expect(JSON.stringify(statuses)).not.toContain('sk-secret-1');
    for (const content of files.values()) expect(content).not.toContain('sk-secret-1');
    expect(call('ai:clearKey', 'openai')).toBe(true);
    expect(call('ai:clearKey', 'nope')).toBe(false);
  });

  it('rejects invalid keys and surfaces keychain errors', () => {
    expect(setup().call('ai:setKey', 'bogus', 'x')).toEqual({ ok: false, error: expect.any(String) });
    expect(setup().call('ai:setKey', 'openai', '  ')).toEqual({ ok: false, error: expect.stringContaining('empty') });
    expect(setup(false).call('ai:setKey', 'openai', 'sk-1')).toEqual({
      ok: false,
      error: expect.stringContaining('Secure storage'),
    });
  });

  it('starts turns asynchronously and streams events through sendEvent', async () => {
    const { call, sendEvent } = setup();
    const request: AiSendRequest = { turnId: 'abc', messages: [{ role: 'user', content: 'hi' }] };
    expect(call('ai:send', request)).toEqual({ started: true });
    await vi.waitFor(() => expect(sendEvent).toHaveBeenCalled());
    expect(sendEvent.mock.calls[0][0]).toMatchObject({ turnId: 'abc', event: { type: 'error' } });
  });

  it('passes the originating IPC event so replies reach the window that started the turn', async () => {
    const { handlers, sendEvent } = setup();
    const origin = { sender: 'window-2' };
    handlers.get('ai:send')!(origin, { turnId: 'w2', messages: [{ role: 'user', content: 'hi' }] });
    await vi.waitFor(() => expect(sendEvent).toHaveBeenCalled());
    expect(sendEvent.mock.calls[0][1]).toBe(origin);
  });

  it('rejects sends without a turn id and cancels unknown turns safely', () => {
    const { call } = setup();
    expect(call('ai:send', {})).toEqual({ started: false });
    expect(call('ai:cancel', 'nope')).toBe(false);
    expect(call('ai:cancel', 5)).toBe(false);
  });

  it('routes tool results and ignores unknown calls', () => {
    expect(setup().call('ai:toolResult', 'nope::x', { ok: true, content: '' })).toBe(false);
  });

  it('reports test-connection failure when no key is set', async () => {
    const result = await setup().call<Promise<{ ok: boolean }>>('ai:testConnection');
    expect(result.ok).toBe(false);
  });
});
