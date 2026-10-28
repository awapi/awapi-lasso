import { describe, expect, it, vi } from 'vitest';
import { createDefaultAiSettings, type AiLlmMessage, type AiStreamEvent, type AiTurnEvent } from '../../shared/aiTypes';
import type { SecretStoreDeps } from '../secretStore';
import { saveAiSettings, setAiKey, type AiSettingsFsDeps } from './aiSettingsStore';
import {
  AiIdleTimeoutError,
  MAX_TOOL_ROUNDS,
  cancelAiTurn,
  resolveAiToolResult,
  runAiTurn,
  testAiConnection,
  validateMessages,
  withIdleTimeout,
  type AiServiceDeps,
} from './aiService';
import type { ProviderRequest, StreamChat } from './providers';

function createDeps(streamChat: StreamChat) {
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
  const events: AiTurnEvent[] = [];
  const deps: AiServiceDeps = {
    fsDeps,
    secretDeps,
    emit: e => events.push(e),
    resolveStreamChat: () => streamChat,
  };
  return { deps, events, secretDeps, fsDeps };
}

const eventsOf = (events: AiTurnEvent[]) => events.map(e => e.event);

describe('validateMessages', () => {
  it('rejects empty, malformed and assistant-last conversations', () => {
    expect(() => validateMessages([])).toThrow(/No messages/);
    expect(() => validateMessages([{ role: 'system', content: 'x' }])).toThrow(/Invalid/);
    expect(() => validateMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])).toThrow(
      /last message/,
    );
  });

  it('drops empty messages, leading assistant turns, and caps history', () => {
    const msgs = [
      { role: 'assistant' as const, content: 'hello' },
      { role: 'user' as const, content: '  ' },
      ...Array.from({ length: 40 }, (_, i) => ({ role: i % 2 === 0 ? ('user' as const) : ('assistant' as const), content: `m${i}` })),
      { role: 'user' as const, content: 'final' },
    ];
    const out = validateMessages(msgs);
    expect(out.length).toBeLessThanOrEqual(30);
    expect(out[0].role).toBe('user');
    expect(out[out.length - 1]).toEqual({ role: 'user', content: 'final' });
  });
});

describe('runAiTurn', () => {
  it('streams provider events tagged with the turn id and passes redacted context to the provider', async () => {
    let captured: ProviderRequest | undefined;
    const stream: StreamChat = async function* (req) {
      captured = req;
      yield { type: 'text-delta', text: 'Hi' };
      yield { type: 'done', stopReason: 'stop' };
    };
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-live-abcdef', secretDeps);

    await runAiTurn(
      {
        turnId: 't1',
        messages: [{ role: 'user', content: 'why?' }],
        context: {
          secretValues: ['hunter2hunter2'],
          request: { method: 'GET', url: 'https://x.test/?api_key=hunter2hunter2' },
        },
      },
      deps,
    );

    expect(events.every(e => e.turnId === 't1')).toBe(true);
    expect(eventsOf(events)).toEqual([
      { type: 'text-delta', text: 'Hi' },
      { type: 'done', stopReason: 'stop' },
    ]);
    expect(captured?.apiKey).toBe('sk-live-abcdef');
    expect(captured?.system).not.toContain('hunter2hunter2');
    expect(captured?.model).toBe(createDefaultAiSettings().models.openai);
  });

  it('emits a done event if the provider stream ends without one', async () => {
    const stream: StreamChat = async function* () {
      yield { type: 'text-delta', text: 'x' };
    };
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    await runAiTurn({ turnId: 't2', messages: [{ role: 'user', content: 'hi' }] }, deps);
    expect(eventsOf(events).at(-1)).toEqual({ type: 'done' });
  });

  it('reports a missing API key without calling the provider', async () => {
    const stream = vi.fn() as unknown as StreamChat;
    const { deps, events } = createDeps(stream);
    await runAiTurn({ turnId: 't3', messages: [{ role: 'user', content: 'hi' }] }, deps);
    expect(stream).not.toHaveBeenCalled();
    expect(eventsOf(events)).toEqual([{ type: 'error', message: expect.stringContaining('API key') }]);
  });

  it('allows keyless OpenAI-compatible providers', async () => {
    const stream: StreamChat = async function* () {
      yield { type: 'done' };
    };
    const { deps, events, fsDeps } = createDeps(stream);
    saveAiSettings({ provider: 'openai-compatible' }, fsDeps);
    await runAiTurn({ turnId: 't4', messages: [{ role: 'user', content: 'hi' }] }, deps);
    expect(eventsOf(events)).toEqual([{ type: 'done' }]);
  });

  it('scrubs the API key and secrets from surfaced errors', async () => {
    const stream: StreamChat = async function* () {
      throw new Error('bad key sk-live-abcdef and hunter2hunter2');
      yield { type: 'done' } as AiStreamEvent;
    };
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-live-abcdef', secretDeps);
    await runAiTurn(
      { turnId: 't5', messages: [{ role: 'user', content: 'hi' }], context: { secretValues: ['hunter2hunter2'] } },
      deps,
    );
    const err = eventsOf(events)[0];
    expect(err.type).toBe('error');
    expect(JSON.stringify(err)).not.toContain('sk-live-abcdef');
    expect(JSON.stringify(err)).not.toContain('hunter2hunter2');
  });

  it('cancels an in-flight turn and reports cancellation instead of an error', async () => {
    const stream: StreamChat = async function* (req) {
      yield { type: 'text-delta', text: 'partial' };
      await new Promise<void>((_, reject) => {
        req.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    };
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    const turn = runAiTurn({ turnId: 't6', messages: [{ role: 'user', content: 'hi' }] }, deps);
    await vi.waitFor(() => expect(events.length).toBe(1));
    expect(cancelAiTurn('t6')).toBe(true);
    await turn;
    expect(eventsOf(events).at(-1)).toEqual({ type: 'done', stopReason: 'cancelled' });
    expect(cancelAiTurn('t6')).toBe(false);
  });

  it('reports invalid messages as an error event', async () => {
    const { deps, events } = createDeps((async function* () {}) as StreamChat);
    await runAiTurn({ turnId: 't7', messages: [] }, deps);
    expect(eventsOf(events)[0]).toMatchObject({ type: 'error' });
  });
});

describe('runAiTurn tool loop', () => {
  const toolStream = (script: Array<AiStreamEvent[]>, seen: AiLlmMessage[][] = []): StreamChat => {
    let round = 0;
    return async function* (req) {
      seen.push(JSON.parse(JSON.stringify(req.messages)) as AiLlmMessage[]);
      for (const e of script[Math.min(round, script.length - 1)]) yield e;
      round += 1;
    };
  };

  const toolCall = (id: string, name: string, args: Record<string, unknown> = {}): AiStreamEvent => ({
    type: 'tool-call',
    call: { id, name, arguments: args },
  });

  /** Answers each tool request the way the renderer would, until the turn finishes. */
  const respondUntilDone = async (
    turn: Promise<void>,
    events: AiTurnEvent[],
    respond: (name: string) => { ok: boolean; content: string },
  ) => {
    let handled = 0;
    const timer = setInterval(() => {
      for (; handled < events.length; handled++) {
        const e = events[handled].event;
        if (e.type === 'tool-call') resolveAiToolResult(e.call.id, respond(e.call.name));
      }
    }, 2);
    try {
      await turn;
    } finally {
      clearInterval(timer);
    }
  };

  it('executes tool calls through the renderer, feeds results back, and finishes', async () => {
    const seen: AiLlmMessage[][] = [];
    const stream = toolStream(
      [
        [{ type: 'text-delta', text: 'Looking.' }, toolCall('c1', 'get_request'), { type: 'done', stopReason: 'tool_use' }],
        [{ type: 'text-delta', text: 'All good.' }, { type: 'done', stopReason: 'stop' }],
      ],
      seen,
    );
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    const turn = runAiTurn({ turnId: 'tl1', toolsEnabled: true, messages: [{ role: 'user', content: 'check' }] }, deps);

    await vi.waitFor(() => expect(eventsOf(events).some(e => e.type === 'tool-call')).toBe(true));
    const request = eventsOf(events).find(e => e.type === 'tool-call');
    expect(request).toMatchObject({ call: { id: 'tl1::c1', name: 'get_request' } });
    expect(resolveAiToolResult('tl1::c1', { ok: true, content: '{"url":"https://x.test"}' })).toBe(true);
    await turn;

    expect(eventsOf(events).filter(e => e.type === 'text-delta').map(e => (e as { text: string }).text).join('')).toBe(
      'Looking.\n\nAll good.',
    );
    expect(eventsOf(events).at(-1)).toEqual({ type: 'done', stopReason: 'stop' });
    expect(seen[1].slice(-2)).toEqual([
      { role: 'assistant', content: 'Looking.', toolCalls: [{ id: 'c1', name: 'get_request', arguments: {} }] },
      { role: 'tool', toolCallId: 'c1', name: 'get_request', content: '{"url":"https://x.test"}' },
    ]);
    expect(resolveAiToolResult('tl1::c1', { ok: true, content: '' })).toBe(false);
  });

  it('scrubs secrets from tool results before they reach the model', async () => {
    const seen: AiLlmMessage[][] = [];
    const stream = toolStream([[toolCall('c1', 'get_response'), { type: 'done' }], [{ type: 'done' }]], seen);
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-live-abcdef', secretDeps);
    const turn = runAiTurn(
      { turnId: 'tl2', toolsEnabled: true, messages: [{ role: 'user', content: 'x' }], context: { secretValues: ['hunter2hunter2'] } },
      deps,
    );
    await respondUntilDone(turn, events, () => ({
      ok: true,
      content: 'body hunter2hunter2 key sk-live-abcdef Bearer abcdefgh12345 {"password":"zzzz"}',
    }));
    const toolMsg = seen[1].find(m => m.role === 'tool');
    expect(toolMsg?.content).not.toMatch(/hunter2hunter2|sk-live-abcdef|abcdefgh12345|zzzz/);
  });

  it('scrubs Main-only secrets (keychain values, OAuth tokens) from the prompt, tool results and errors', async () => {
    const seen: AiLlmMessage[][] = [];
    let system = '';
    const base = toolStream([[toolCall('c1', 'get_response'), { type: 'done' }], [{ type: 'done' }]], seen);
    const stream: StreamChat = req => {
      system = req.system;
      return base(req);
    };
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    const turn = runAiTurn(
      {
        turnId: 'ms1',
        toolsEnabled: true,
        messages: [{ role: 'user', content: 'x' }],
        context: { response: { status: 200, body: 'echo oauth-access-777' } },
      },
      { ...deps, getMainSecretValues: () => ['oauth-access-777'] },
    );
    await respondUntilDone(turn, events, () => ({ ok: true, content: 'token oauth-access-777' }));
    expect(system).not.toContain('oauth-access-777');
    expect(seen[1].find(m => m.role === 'tool')?.content).not.toContain('oauth-access-777');

    const failing: StreamChat = async function* () {
      throw new Error('upstream leaked oauth-access-777');
    };
    const second = createDeps(failing);
    setAiKey('openai', 'sk-1', second.secretDeps);
    await runAiTurn(
      { turnId: 'ms2', messages: [{ role: 'user', content: 'x' }] },
      { ...second.deps, getMainSecretValues: () => { throw new Error('vault broken'); } },
    );
    await runAiTurn(
      { turnId: 'ms3', messages: [{ role: 'user', content: 'x' }] },
      { ...second.deps, getMainSecretValues: () => ['oauth-access-777'] },
    );
    const errors = eventsOf(second.events).filter(e => e.type === 'error');
    expect(errors).toHaveLength(2);
    expect(JSON.stringify(errors[1])).not.toContain('oauth-access-777');
  });

  it('replays the provider\'s raw content (e.g. thinking blocks) on the next tool round, never to the renderer', async () => {
    const seen: AiLlmMessage[][] = [];
    const raw = [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'tool_use', id: 'c1', name: 'get_request', input: {} }];
    const stream = toolStream(
      [[toolCall('c1', 'get_request'), { type: 'provider-content', content: raw } as never, { type: 'done' }], [{ type: 'done' }]],
      seen,
    );
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    const turn = runAiTurn({ turnId: 'pc1', toolsEnabled: true, messages: [{ role: 'user', content: 'x' }] }, deps);
    await respondUntilDone(turn, events, () => ({ ok: true, content: '{}' }));
    expect(seen[1].find(m => m.role === 'assistant')).toMatchObject({ providerContent: raw });
    expect(eventsOf(events).some(e => (e.type as string) === 'provider-content')).toBe(false);
  });

  it('rejects unknown tools and malformed arguments without asking the renderer', async () => {
    const seen: AiLlmMessage[][] = [];
    const stream = toolStream(
      [
        [
          toolCall('c1', 'delete_everything'),
          { type: 'tool-call', call: { id: 'c2', name: 'get_request', arguments: {}, argumentsError: 'bad json' } },
          { type: 'done' },
        ],
        [{ type: 'done' }],
      ],
      seen,
    );
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    await runAiTurn({ turnId: 'tl3', toolsEnabled: true, messages: [{ role: 'user', content: 'x' }] }, deps);
    expect(eventsOf(events).some(e => e.type === 'tool-call')).toBe(false);
    expect(seen[1].filter(m => m.role === 'tool').map(m => (m as { content: string }).content)).toEqual([
      'Unknown tool "delete_everything".',
      'bad json',
    ]);
  });

  it('ignores tool calls when tools are not enabled and passes no tools to the provider', async () => {
    let tools: unknown = 'unset';
    const stream: StreamChat = async function* (req) {
      tools = req.tools;
      yield toolCall('c1', 'get_request');
      yield { type: 'done' };
    };
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    await runAiTurn({ turnId: 'tl4', messages: [{ role: 'user', content: 'x' }] }, deps);
    expect(tools).toBeUndefined();
    expect(eventsOf(events)).toEqual([{ type: 'done', stopReason: undefined }]);
  });

  it('stops after the maximum number of tool rounds', async () => {
    const stream = toolStream([[toolCall('c', 'get_request'), { type: 'done' }]]);
    const { deps, events, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    const turn = runAiTurn({ turnId: 'tl5', toolsEnabled: true, messages: [{ role: 'user', content: 'x' }] }, deps);
    await respondUntilDone(turn, events, () => ({ ok: true, content: '{}' }));
    expect(eventsOf(events).filter(e => e.type === 'tool-call')).toHaveLength(MAX_TOOL_ROUNDS);
    expect(eventsOf(events).at(-1)).toEqual({ type: 'done', stopReason: 'max_tool_rounds' });
  });

  it('cancels while waiting on a tool and times out silent tools', async () => {
    const stream = toolStream([[toolCall('c', 'get_request'), { type: 'done' }], [{ type: 'done' }]]);
    const first = createDeps(stream);
    setAiKey('openai', 'sk-1', first.secretDeps);
    const turn = runAiTurn({ turnId: 'tl6', toolsEnabled: true, messages: [{ role: 'user', content: 'x' }] }, first.deps);
    await vi.waitFor(() => expect(eventsOf(first.events).some(e => e.type === 'tool-call')).toBe(true));
    expect(cancelAiTurn('tl6')).toBe(true);
    await turn;
    expect(eventsOf(first.events).at(-1)).toEqual({ type: 'done', stopReason: 'cancelled' });
    expect(resolveAiToolResult('tl6::c', { ok: true, content: '' })).toBe(false);

    const seen: AiLlmMessage[][] = [];
    const second = createDeps(toolStream([[toolCall('c', 'get_request'), { type: 'done' }], [{ type: 'done' }]], seen));
    setAiKey('openai', 'sk-1', second.secretDeps);
    await runAiTurn(
      { turnId: 'tl7', toolsEnabled: true, messages: [{ role: 'user', content: 'x' }] },
      { ...second.deps, toolTimeoutMs: 20 },
    );
    expect(seen[1].find(m => m.role === 'tool')).toMatchObject({ content: expect.stringContaining('did not respond') });
  });

  it('treats invalid renderer results as tool errors', async () => {
    const seen: AiLlmMessage[][] = [];
    const { deps, events, secretDeps } = createDeps(
      toolStream([[toolCall('c', 'get_request'), { type: 'done' }], [{ type: 'done' }]], seen),
    );
    setAiKey('openai', 'sk-1', secretDeps);
    const turn = runAiTurn({ turnId: 'tl8', toolsEnabled: true, messages: [{ role: 'user', content: 'x' }] }, deps);
    await vi.waitFor(() => expect(eventsOf(events).some(e => e.type === 'tool-call')).toBe(true));
    expect(resolveAiToolResult('tl8::c', 'garbage')).toBe(true);
    await turn;
    expect(seen[1].find(m => m.role === 'tool')).toMatchObject({ content: expect.stringContaining('invalid result') });
    expect(resolveAiToolResult(42, {})).toBe(false);
  });
});

describe('testAiConnection', () => {
  it('fails without a key', async () => {
    const { deps } = createDeps((async function* () {}) as StreamChat);
    const result = await testAiConnection(deps);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/API key/);
  });

  it('succeeds when the provider streams text', async () => {
    let maxTokens = 0;
    const stream: StreamChat = async function* (req) {
      maxTokens = req.maxTokens;
      yield { type: 'text-delta', text: 'OK' };
      yield { type: 'done' };
    };
    const { deps, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1', secretDeps);
    const result = await testAiConnection(deps);
    expect(result).toEqual({ ok: true, message: expect.stringContaining('Connected to OpenAI') });
    expect(maxTokens).toBe(16);
  });

  it('returns a scrubbed failure message', async () => {
    const stream: StreamChat = async function* () {
      throw new Error('HTTP 401 for key sk-1-secretkey');
      yield { type: 'done' } as AiStreamEvent;
    };
    const { deps, secretDeps } = createDeps(stream);
    setAiKey('openai', 'sk-1-secretkey', secretDeps);
    const result = await testAiConnection(deps);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain('sk-1-secretkey');
  });
});

describe('provider idle timeout', () => {
  it('passes events through and fails a stalled stream, aborting the request', async () => {
    async function* stalls() {
      yield 1;
      await new Promise(() => {});
    }
    const onTimeout = vi.fn();
    const seen: number[] = [];
    await expect(
      (async () => {
        for await (const n of withIdleTimeout(stalls(), 20, onTimeout)) seen.push(n);
      })(),
    ).rejects.toBeInstanceOf(AiIdleTimeoutError);
    expect(seen).toEqual([1]);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('reports a hung provider as an error and aborts its signal', async () => {
    let signal: AbortSignal | undefined;
    const hung: StreamChat = async function* (request: ProviderRequest) {
      signal = request.signal;
      yield { type: 'text-delta', text: 'Hi' } as AiStreamEvent;
      await new Promise(() => {});
    };
    const { deps, events, secretDeps } = createDeps(hung);
    setAiKey('openai', 'sk-1', secretDeps);
    await runAiTurn(
      { turnId: 'idle1', messages: [{ role: 'user', content: 'x' }] },
      { ...deps, providerIdleTimeoutMs: 20 },
    );
    expect(eventsOf(events).at(-1)).toMatchObject({ type: 'error', message: expect.stringContaining('stopped responding') });
    expect(signal?.aborted).toBe(true);
  });
});
