import { describe, expect, it } from 'vitest';
import {
  AiProviderError,
  describeHttpError,
  joinUrl,
  parseModelIds,
  parseToolArguments,
  responseBodyChunks,
} from './types';

describe('provider helpers', () => {
  it('reads unique model ids from a /models response and ignores junk', () => {
    expect(parseModelIds({ data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: '' }, { id: 3 }, null, {}] })).toEqual([
      'a',
      'b',
    ]);
    expect(parseModelIds(null)).toEqual([]);
    expect(parseModelIds({ data: 'nope' })).toEqual([]);
  });

  it('joins URLs without duplicate slashes', () => {
    expect(joinUrl('https://a.test/v1/', '/chat/completions')).toBe('https://a.test/v1/chat/completions');
    expect(joinUrl('https://a.test/v1', 'messages')).toBe('https://a.test/v1/messages');
  });

  it.each([
    [401, /rejected the API key/],
    [403, /rejected the API key/],
    [404, /model name and base URL/],
    [429, /rate limit/],
    [503, /having problems/],
    [400, /request failed \(HTTP 400\)/],
  ])('maps HTTP %i', (status, pattern) => {
    const err = describeHttpError(status, '', 'Prov');
    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.status).toBe(status);
    expect(err.message).toMatch(pattern);
  });

  it('appends provider error details from JSON or text bodies', () => {
    expect(describeHttpError(400, '{"error":{"message":"bad model"}}', 'P').message).toContain('bad model');
    expect(describeHttpError(400, '{"error":"plain"}', 'P').message).toContain('plain');
    expect(describeHttpError(400, 'raw text', 'P').message).toContain('raw text');
  });

  it('streams response bytes and rejects empty bodies', async () => {
    const chunks: string[] = [];
    for await (const c of responseBodyChunks(new Response('abc'))) chunks.push(new TextDecoder().decode(c));
    expect(chunks.join('')).toBe('abc');
    expect(() => responseBodyChunks(new Response(null))).toThrow(AiProviderError);
  });

  it('parses tool arguments and reports invalid ones', () => {
    expect(parseToolArguments('i', 'n', '')).toEqual({ id: 'i', name: 'n', arguments: {} });
    expect(parseToolArguments('i', 'n', '{"a":1}')).toEqual({ id: 'i', name: 'n', arguments: { a: 1 } });
    expect(parseToolArguments('i', 'n', '[1]').argumentsError).toMatch(/object/);
    expect(parseToolArguments('i', 'n', '{bad').argumentsError).toMatch(/valid JSON/);
  });
});
