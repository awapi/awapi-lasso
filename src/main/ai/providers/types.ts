import type { AiLlmMessage, AiStreamEvent, AiToolCall, AiToolDefinition } from '../../../shared/aiTypes';

export interface ProviderRequest {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  system: string;
  messages: AiLlmMessage[];
  /** Tools the model may call; omit for plain chat. */
  tools?: readonly AiToolDefinition[];
  temperature: number;
  maxTokens: number;
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Provider events: the renderer-facing stream plus raw assistant content the agent loop replays within a turn. */
export type ProviderStreamEvent = AiStreamEvent | { type: 'provider-content'; content: unknown[] };

export type StreamChat = (request: ProviderRequest) => AsyncGenerator<ProviderStreamEvent, void, undefined>;

export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

function extractErrorMessage(bodyText: string): string | null {
  try {
    const parsed = JSON.parse(bodyText) as { error?: { message?: unknown } | string; message?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message;
    if (typeof parsed.message === 'string') return parsed.message;
  } catch {
    // not JSON
  }
  return null;
}

/** Maps a non-2xx provider response to a short, user-friendly error. */
export function describeHttpError(status: number, bodyText: string, providerLabel: string): AiProviderError {
  const detail = extractErrorMessage(bodyText) ?? bodyText.trim().slice(0, 300);
  let message: string;
  if (status === 401 || status === 403) {
    message = `${providerLabel} rejected the API key (HTTP ${status}). Check the key in AI settings.`;
  } else if (status === 404) {
    message = `${providerLabel} returned 404. Check the model name and base URL.`;
  } else if (status === 429) {
    message = `${providerLabel} rate limit or quota exceeded (HTTP 429).`;
  } else if (status >= 500) {
    message = `${providerLabel} is having problems (HTTP ${status}). Try again shortly.`;
  } else {
    message = `${providerLabel} request failed (HTTP ${status}).`;
  }
  return new AiProviderError(detail ? `${message} ${detail}` : message, status);
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/** Wraps `response.body` (a web ReadableStream) as an async iterable of bytes. */
export function responseBodyChunks(response: Response): AsyncIterable<Uint8Array> {
  const body = response.body;
  if (!body) {
    throw new AiProviderError('The provider returned an empty response stream.');
  }
  return {
    async *[Symbol.asyncIterator]() {
      const reader = body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) return;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

/** Parses accumulated JSON tool arguments; malformed JSON is reported instead of thrown. */
export function parseToolArguments(id: string, name: string, raw: string): AiToolCall {
  const text = raw.trim();
  if (text === '') return { id, name, arguments: {} };
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { id, name, arguments: parsed as Record<string, unknown> };
    }
    return { id, name, arguments: {}, argumentsError: 'Tool arguments must be a JSON object.' };
  } catch {
    return { id, name, arguments: {}, argumentsError: 'Tool arguments were not valid JSON.' };
  }
}
