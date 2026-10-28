import { describe, expect, it } from 'vitest';
import { saveAiSettings, type AiSettingsFsDeps } from './aiSettingsStore';
import { resolveAiToolResult, runAiTurn, testAiConnection, type AiServiceDeps } from './aiService';
import type { AiTurnEvent } from '../../shared/aiTypes';
import type { SecretStoreDeps } from '../secretStore';
import { executeAiTool, type AiToolHost } from '../../renderer/src/aiToolHost';
import { createDefaultHttpRequest, createEmptyCollection, type RequestItem } from '../../shared/collectionSchema';

/**
 * Optional smoke test against a real OpenAI-compatible server (e.g. LM Studio / Ollama).
 * Skipped unless AI_LIVE_BASE_URL is set:
 *   AI_LIVE_BASE_URL=http://localhost:1234/v1 AI_LIVE_MODEL=qwen/qwen3.6-35b-a3b npx vitest run src/main/ai/aiLive.test.ts
 */
const baseUrl = process.env.AI_LIVE_BASE_URL;
const model = process.env.AI_LIVE_MODEL ?? 'llama3.1';

function createLiveDeps() {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/userdata']);
  const secretDeps: SecretStoreDeps = {
    userDataDir: '/userdata',
    isEncryptionAvailable: () => true,
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
  saveAiSettings(
    {
      provider: 'openai-compatible',
      models: { 'openai-compatible': model } as never,
      baseUrls: { 'openai-compatible': baseUrl as string } as never,
      maxTokens: 4096,
    },
    fsDeps,
  );
  const events: AiTurnEvent[] = [];
  const deps: AiServiceDeps = { fsDeps, secretDeps, emit: e => events.push(e) };
  return { deps, events };
}

describe.skipIf(!baseUrl)('live OpenAI-compatible server', () => {
  it('passes Test connection', async () => {
    const { deps } = createLiveDeps();
    const result = await testAiConnection(deps);
    expect(result.message).toContain('Connected');
    expect(result.ok).toBe(true);
  }, 180000);

  it('streams a plain chat answer', async () => {
    const { deps, events } = createLiveDeps();
    await runAiTurn(
      { turnId: 'live1', messages: [{ role: 'user', content: 'In one short sentence, what is HTTP status 404?' }] },
      deps,
    );
    const text = events
      .map(e => e.event)
      .filter(e => e.type === 'text-delta')
      .map(e => (e as { text: string }).text)
      .join('');
    expect(events.at(-1)?.event.type).toBe('done');
    expect(text.toLowerCase()).toMatch(/not found|404/);
  }, 180000);

  it('calls a workspace tool, receives the result, and answers from it', async () => {
    const { deps, events } = createLiveDeps();
    let handled = 0;
    const timer = setInterval(() => {
      for (; handled < events.length; handled++) {
        const e = events[handled].event;
        if (e.type === 'tool-call') {
          resolveAiToolResult(e.call.id, {
            ok: true,
            content: JSON.stringify({ name: 'Get users', method: 'GET', url: '{{baseUrl}}/users', authType: 'bearer' }),
          });
        }
      }
    }, 20);
    try {
      await runAiTurn(
        {
          turnId: 'live2',
          toolsEnabled: true,
          messages: [{ role: 'user', content: 'Use the get_request tool, then tell me the URL of the active request.' }],
        },
        deps,
      );
    } finally {
      clearInterval(timer);
    }
    const all = events.map(e => e.event);
    expect(all.some(e => e.type === 'tool-call' && e.call.name === 'get_request')).toBe(true);
    expect(all.some(e => e.type === 'error')).toBe(false);
    const text = all
      .filter(e => e.type === 'text-delta')
      .map(e => (e as { text: string }).text)
      .join('');
    expect(text).toContain('/users');
  }, 300000);

  it('edits a request through the real tool executors (end to end)', async () => {
    const { deps, events } = createLiveDeps();
    let request: RequestItem = createDefaultHttpRequest({
      id: 'req_live',
      name: 'Get users',
      url: '{{baseUrl}}/users',
      auth: { type: 'bearer', bearer: { token: 'live-secret-token-123' } },
      headers: [{ key: 'Authorization', value: 'Bearer live-secret-token-123', enabled: true }],
    });
    const host: AiToolHost = {
      workspace: {
        getCollections: () => [{ filePath: '/c.awjc', collection: createEmptyCollection('Live', { items: [request] }) }],
        getActiveCollectionPath: () => '/c.awjc',
        getTabs: () => [{ id: 'tab1', collectionPath: '/c.awjc', request }],
        getActiveTabId: () => 'tab1',
        getResponse: () => null,
        getGraphqlSchema: () => null,
        getSecretValues: () => ['live-secret-token-123'],
        updateRequest: (_id, next) => {
          request = next;
        },
        updateCollection: () => {},
        addRequest: () => {},
        openRequest: () => true,
        sendActiveRequest: async () => null,
      },
      requestApproval: async () => true,
      getApprovalPolicy: async () => ({ autoApplyEdits: true, confirmBeforeRun: true }),
    };
    const toolResults: string[] = [];
    let handled = 0;
    const timer = setInterval(() => {
      for (; handled < events.length; handled++) {
        const e = events[handled].event;
        if (e.type === 'tool-call') {
          void executeAiTool({ ...e.call, id: e.call.id }, host).then(result => {
            toolResults.push(result.content);
            resolveAiToolResult(e.call.id, result);
          });
        }
      }
    }, 20);
    try {
      await runAiTurn(
        {
          turnId: 'live3',
          toolsEnabled: true,
          messages: [{ role: 'user', content: 'Add an "Accept: application/json" header to the active request, then confirm.' }],
          context: { secretValues: ['live-secret-token-123'] },
        },
        deps,
      );
    } finally {
      clearInterval(timer);
    }
    const all = events.map(e => e.event);
    expect(all.some(e => e.type === 'error')).toBe(false);
    expect(request.headers?.find(h => h.key.toLowerCase() === 'accept')?.value).toBe('application/json');
    expect(request.headers?.find(h => h.key === 'Authorization')?.value).toBe('Bearer live-secret-token-123');
    expect(request.auth?.bearer?.token).toBe('live-secret-token-123');
    expect(JSON.stringify(toolResults)).not.toContain('live-secret-token-123');
    expect(JSON.stringify(all)).not.toContain('live-secret-token-123');
  }, 300000);
});
