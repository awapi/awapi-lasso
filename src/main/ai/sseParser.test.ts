import { describe, expect, it } from 'vitest';
import { parseSseStream, type SseMessage } from './sseParser';

const enc = new TextEncoder();

async function* chunks(parts: string[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield enc.encode(p);
}

async function collect(parts: string[]): Promise<SseMessage[]> {
  const out: SseMessage[] = [];
  for await (const m of parseSseStream(chunks(parts))) out.push(m);
  return out;
}

describe('parseSseStream', () => {
  it('parses events with names and data', async () => {
    expect(await collect(['event: a\ndata: {"x":1}\n\ndata: two\n\n'])).toEqual([
      { event: 'a', data: '{"x":1}' },
      { event: undefined, data: 'two' },
    ]);
  });

  it('handles messages split across chunks, including mid-line and mid-CRLF', async () => {
    expect(await collect(['da', 'ta: hel', 'lo\r', '\n\r', '\n', 'data: x\r\n\r\n'])).toEqual([
      { event: undefined, data: 'hello' },
      { event: undefined, data: 'x' },
    ]);
  });

  it('joins multi-line data and ignores comments', async () => {
    expect(await collect([': ping\ndata: a\ndata: b\n\n'])).toEqual([{ event: undefined, data: 'a\nb' }]);
  });

  it('flushes a final message without a trailing blank line', async () => {
    expect(await collect(['data: tail'])).toEqual([{ event: undefined, data: 'tail' }]);
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = enc.encode('data: héllo\n\n');
    const split = 8;
    async function* two(): AsyncGenerator<Uint8Array> {
      yield bytes.slice(0, split);
      yield bytes.slice(split);
    }
    const out: SseMessage[] = [];
    for await (const m of parseSseStream(two())) out.push(m);
    expect(out).toEqual([{ event: undefined, data: 'héllo' }]);
  });
});
