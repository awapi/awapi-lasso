import { describe, expect, it, vi } from 'vitest';
import type { AiStreamEvent } from '../../../shared/aiTypes';
import {
  buildOpenAiBody,
  listOpenAiCompatibleModels,
  listOpenAiModels,
  streamOpenAiChat,
  streamOpenAiCompatibleChat,
  toOpenAiMessages,
} from './openaiProvider';
import { AiProviderError, type ProviderRequest } from './types';

function sseResponse(frames: string[], status = 200): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

function baseRequest(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1/',
    model: 'gpt-4o-mini',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.3,
    maxTokens: 100,
    ...overrides,
  };
}

async function drain(gen: AsyncGenerator<AiStreamEvent>): Promise<AiStreamEvent[]> {
  const out: AiStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('openai provider', () => {
  it('streams text deltas and a done event', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const events = await drain(streamOpenAiChat(baseRequest({ fetchImpl })));
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'done', stopReason: 'stop' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.stream).toBe(true);
  });

  it('omits Authorization when no key is provided (local servers)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(['data: [DONE]\n\n']));
    await drain(streamOpenAiCompatibleChat(baseRequest({ apiKey: null, fetchImpl })));
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('uses max_completion_tokens and no temperature for reasoning models', () => {
    const body = buildOpenAiBody(baseRequest({ model: 'o3-mini' }), true);
    expect(body.max_completion_tokens).toBe(100);
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('uses max_tokens and temperature for compatible servers', () => {
    const body = buildOpenAiBody(baseRequest({ model: 'llama3.1' }), false);
    expect(body.max_tokens).toBe(100);
    expect(body.temperature).toBe(0.3);
  });

  it('maps HTTP errors to friendly messages', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"error":{"message":"Incorrect API key"}}', { status: 401 }));
    await expect(drain(streamOpenAiChat(baseRequest({ fetchImpl })))).rejects.toMatchObject({
      name: 'AiProviderError',
      status: 401,
      message: expect.stringContaining('Incorrect API key'),
    });
  });

  it('throws on in-stream errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse(['data: {"error":{"message":"boom"}}\n\n']));
    await expect(drain(streamOpenAiChat(baseRequest({ fetchImpl })))).rejects.toBeInstanceOf(AiProviderError);
  });

  it('skips malformed chunks', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(sseResponse(['data: nope\n\n', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n']));
    const events = await drain(streamOpenAiChat(baseRequest({ fetchImpl })));
    expect(events[0]).toEqual({ type: 'text-delta', text: 'ok' });
  });

  it('assembles streamed tool calls from partial deltas and emits them before done', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Checking"}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"get_re","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"quest","arguments":"{\\"requestId\\":"}}]}}]}\n\n',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"r1\\"}"}},{"index":1,"id":"call_b","function":{"name":"get_response","arguments":""}}]}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const tools = [{ name: 'get_request', description: 'd', parameters: { type: 'object' }, risk: 'read' as const }];
    const events = await drain(streamOpenAiChat(baseRequest({ fetchImpl, tools })));
    expect(events).toEqual([
      { type: 'text-delta', text: 'Checking' },
      { type: 'tool-call', call: { id: 'call_a', name: 'get_request', arguments: { requestId: 'r1' } } },
      { type: 'tool-call', call: { id: 'call_b', name: 'get_response', arguments: {} } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools[0]).toEqual({
      type: 'function',
      function: { name: 'get_request', description: 'd', parameters: { type: 'object' } },
    });
  });

  it('flags malformed tool arguments instead of throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"get_request","arguments":"{oops"}}]}}]}\n\n',
      ]),
    );
    const events = await drain(streamOpenAiChat(baseRequest({ fetchImpl })));
    expect(events[0]).toMatchObject({ type: 'tool-call', call: { name: 'get_request', argumentsError: expect.any(String) } });
  });

  it('serializes tool turns into OpenAI messages', () => {
    const out = toOpenAiMessages('sys', [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'get_request', arguments: { a: 1 } }] },
      { role: 'tool', toolCallId: 'c1', name: 'get_request', content: '{"ok":true}' },
    ]);
    expect(out).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_request', arguments: '{"a":1}' } }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
    ]);
  });

  it('omits the tools field when none are given', () => {
    expect(buildOpenAiBody(baseRequest(), true)).not.toHaveProperty('tools');
  });
});

describe('openai model listing', () => {
  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('lists chat models from OpenAI, sorted, without embedding/audio/image models', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          { id: 'gpt-5' },
          { id: 'text-embedding-3-small' },
          { id: 'whisper-1' },
          { id: 'gpt-4o-mini-tts' },
          { id: 'dall-e-3' },
          { id: 'gpt-4.1' },
          { id: 'omni-moderation-latest' },
        ],
      }),
    );
    const models = await listOpenAiModels({ apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1/', fetchImpl });
    expect(models).toEqual(['gpt-4.1', 'gpt-5']);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('keeps every model from compatible servers and sends no key when none is set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ data: [{ id: 'qwen3' }, { id: 'nomic-embed-text' }] }));
    const models = await listOpenAiCompatibleModels({ apiKey: null, baseUrl: 'http://localhost:11434/v1', fetchImpl });
    expect(models).toEqual(['nomic-embed-text', 'qwen3']);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('maps HTTP errors and tolerates non-JSON bodies', async () => {
    const failing = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'bad key' } }, 401));
    await expect(listOpenAiModels({ apiKey: 'sk', baseUrl: 'https://api.openai.com/v1', fetchImpl: failing })).rejects.toThrow(
      /rejected the API key/,
    );
    const html = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(listOpenAiCompatibleModels({ apiKey: null, baseUrl: 'http://x/v1', fetchImpl: html })).resolves.toEqual([]);
  });
});
