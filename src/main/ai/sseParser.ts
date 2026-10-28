export interface SseMessage {
  event?: string;
  data: string;
}

/** Parses a Server-Sent Events byte stream into messages (handles CRLF, multi-line data and comments). */
export async function* parseSseStream(
  stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<SseMessage, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const flush = (): SseMessage | null => {
    if (dataLines.length === 0) {
      eventName = undefined;
      return null;
    }
    const message: SseMessage = { event: eventName, data: dataLines.join('\n') };
    eventName = undefined;
    dataLines = [];
    return message;
  };

  const processLine = (line: string): SseMessage | null => {
    if (line === '') return flush();
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
    return null;
  };

  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.search(/\r\n|\n|\r/);
    while (newline >= 0) {
      const match = /\r\n|\n|\r/.exec(buffer.slice(newline)) as RegExpExecArray;
      const line = buffer.slice(0, newline);
      const consumed = newline + match[0].length;
      // A lone trailing "\r" may be the first half of "\r\n"; wait for more data.
      if (match[0] === '\r' && consumed === buffer.length) break;
      buffer = buffer.slice(consumed);
      const message = processLine(line);
      if (message) yield message;
      newline = buffer.search(/\r\n|\n|\r/);
    }
  }

  buffer += decoder.decode();
  if (buffer.length > 0) {
    const message = processLine(buffer.replace(/\r$/, ''));
    if (message) yield message;
  }
  const last = flush();
  if (last) yield last;
}
