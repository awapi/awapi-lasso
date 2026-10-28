import { describe, expect, it, vi } from 'vitest';
import {
  ANTHROPIC_VERSION,
  REFUSAL_NOTICE,
  acceptsSamplingParams,
  buildAnthropicBody,
  listAnthropicModels,
  streamAnthropicChat,
  toAnthropicMessages,
} from './anthropicProvider';
import type { ProviderRequest, ProviderStreamEvent } from './types';

function sseResponse(frames: string[], status = 200): Response {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    }),
    { status },
  );
}

function baseRequest(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    apiKey: 'sk-ant-test',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
    system: 'sys',
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.2,
    maxTokens: 256,
    ...overrides,
  };
}

async function drain(gen: AsyncGenerator<ProviderStreamEvent>): Promise<ProviderStreamEvent[]> {
  const out: ProviderStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('anthropic provider', () => {
  it('builds a Messages API body with a top-level system prompt', () => {
    expect(buildAnthropicBody(baseRequest())).toEqual({
      model: 'claude-sonnet-4-5',
      max_tokens: 256,
      temperature: 0.2,
      stream: true,
      system: 'sys',
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('streams text deltas and the stop reason', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'event: message_start\ndata: {"type":"message_start"}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    const events = await drain(streamAnthropicChat(baseRequest({ fetchImpl })));
    expect(events).toEqual([
      { type: 'text-delta', text: 'Hi ' },
      { type: 'text-delta', text: 'there' },
      { type: 'done', stopReason: 'end_turn' },
    ]);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
  });

  it('requires an API key', async () => {
    await expect(drain(streamAnthropicChat(baseRequest({ apiKey: null })))).rejects.toThrow(/API key/);
  });

  it('maps HTTP and in-stream errors', async () => {
    const http429 = vi.fn().mockResolvedValue(new Response('{"error":{"message":"slow down"}}', { status: 429 }));
    await expect(drain(streamAnthropicChat(baseRequest({ fetchImpl: http429 })))).rejects.toThrow(/rate limit/);

    const inStream = vi
      .fn()
      .mockResolvedValue(sseResponse(['event: error\ndata: {"type":"error","error":{"message":"overloaded"}}\n\n']));
    await expect(drain(streamAnthropicChat(baseRequest({ fetchImpl: inStream })))).rejects.toThrow(/overloaded/);
  });

  it('assembles streamed tool_use blocks from partial JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Looking"}}\n\n',
        'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_request"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"requestId\\":"}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"r1\\"}"}}\n\n',
        'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
      ]),
    );
    const tools = [{ name: 'get_request', description: 'd', parameters: { type: 'object' }, risk: 'read' as const }];
    const events = await drain(streamAnthropicChat(baseRequest({ fetchImpl, tools })));
    expect(events).toEqual([
      { type: 'text-delta', text: 'Looking' },
      { type: 'tool-call', call: { id: 'toolu_1', name: 'get_request', arguments: { requestId: 'r1' } } },
      {
        type: 'provider-content',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_request', input: { requestId: 'r1' } }],
      },
      { type: 'done', stopReason: 'tool_use' },
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toEqual([{ name: 'get_request', description: 'd', input_schema: { type: 'object' } }]);
  });

  it('groups consecutive tool results into one user message after tool_use', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'let me look',
        toolCalls: [
          { id: 't1', name: 'a', arguments: {} },
          { id: 't2', name: 'b', arguments: { x: 1 } },
        ],
      },
      { role: 'tool', toolCallId: 't1', name: 'a', content: 'r1' },
      { role: 'tool', toolCallId: 't2', name: 'b', content: 'r2' },
    ]);
    expect(out).toEqual([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'let me look' },
          { type: 'tool_use', id: 't1', name: 'a', input: {} },
          { type: 'tool_use', id: 't2', name: 'b', input: { x: 1 } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'r1' },
          { type: 'tool_result', tool_use_id: 't2', content: 'r2' },
        ],
      },
    ]);
  });

  it('omits temperature for models that reject sampling parameters', () => {
    for (const model of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-opus-4-7', 'claude-opus-4-8']) {
      expect(acceptsSamplingParams(model)).toBe(false);
      expect(buildAnthropicBody(baseRequest({ model }))).not.toHaveProperty('temperature');
    }
    for (const model of ['claude-sonnet-4-5', 'claude-opus-4-6', 'claude-haiku-4-5']) {
      expect(acceptsSamplingParams(model)).toBe(true);
    }
  });

  it('captures thinking blocks with signatures in stream order and replays them unchanged', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}\n\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig=="}}\n\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"redacted_thinking","data":"opaque"}}\n\n',
        'data: {"type":"content_block_stop","index":1}\n\n',
        'data: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}\n\n',
        'data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Checking"}}\n\n',
        'data: {"type":"content_block_stop","index":2}\n\n',
        'data: {"type":"content_block_start","index":3,"content_block":{"type":"tool_use","id":"toolu_9","name":"get_request","input":{}}}\n\n',
        'data: {"type":"content_block_delta","index":3,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
        'data: {"type":"content_block_stop","index":3}\n\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
      ]),
    );
    const events = await drain(streamAnthropicChat(baseRequest({ fetchImpl, model: 'claude-opus-5-5' })));
    expect(events.filter(e => e.type === 'text-delta')).toEqual([{ type: 'text-delta', text: 'Checking' }]);
    const content = events.find(e => e.type === 'provider-content');
    expect(content).toEqual({
      type: 'provider-content',
      content: [
        { type: 'thinking', thinking: 'plan', signature: 'sig==' },
        { type: 'redacted_thinking', data: 'opaque' },
        { type: 'text', text: 'Checking' },
        { type: 'tool_use', id: 'toolu_9', name: 'get_request', input: {} },
      ],
    });

    const replay = toAnthropicMessages([
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'Checking',
        toolCalls: [{ id: 'toolu_9', name: 'get_request', arguments: {} }],
        providerContent: (content as { content: unknown[] }).content,
      },
      { role: 'tool', toolCallId: 'toolu_9', name: 'get_request', content: '{}' },
    ]);
    expect(replay[1]).toEqual({ role: 'assistant', content: (content as { content: unknown[] }).content });
  });

  it('tells the user when Claude declines', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      sseResponse(['data: {"type":"message_delta","delta":{"stop_reason":"refusal"}}\n\n']),
    );
    const events = await drain(streamAnthropicChat(baseRequest({ fetchImpl })));
    expect(events).toEqual([
      { type: 'text-delta', text: REFUSAL_NOTICE },
      { type: 'done', stopReason: 'refusal' },
    ]);
  });
});

describe('anthropic model listing', () => {
  it('lists models in API order with the Anthropic headers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'claude-opus-5-5' }, { id: 'claude-haiku-5-5' }], has_more: false }), {
        status: 200,
      }),
    );
    const models = await listAnthropicModels({ apiKey: 'sk-ant', baseUrl: 'https://api.anthropic.com/v1', fetchImpl });
    expect(models).toEqual(['claude-opus-5-5', 'claude-haiku-5-5']);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant');
    expect(headers['anthropic-version']).toBe(ANTHROPIC_VERSION);
  });

  it('requires a key and maps HTTP errors', async () => {
    const fetchImpl = vi.fn();
    await expect(listAnthropicModels({ apiKey: null, baseUrl: 'https://api.anthropic.com/v1', fetchImpl })).rejects.toThrow(
      /No Anthropic API key/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    fetchImpl.mockResolvedValue(new Response('{"error":{"message":"invalid x-api-key"}}', { status: 401 }));
    await expect(listAnthropicModels({ apiKey: 'k', baseUrl: 'https://api.anthropic.com/v1', fetchImpl })).rejects.toThrow(
      /rejected the API key/,
    );
  });
});
