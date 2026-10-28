import type { AiLlmMessage, AiStreamEvent } from '../../../shared/aiTypes';
import { parseSseStream } from '../sseParser';
import {
  AiProviderError,
  describeHttpError,
  joinUrl,
  parseModelIds,
  parseToolArguments,
  responseBodyChunks,
  type ListModelsRequest,
  type ProviderRequest,
} from './types';

interface OpenAiChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
}

/** Newer OpenAI reasoning models reject custom temperature and the legacy `max_tokens` field. */
function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model);
}

export function toOpenAiMessages(system: string, messages: AiLlmMessage[]): unknown[] {
  const out: unknown[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map(c => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function buildOpenAiBody(request: ProviderRequest, official: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    stream: true,
    messages: toOpenAiMessages(request.system, request.messages),
  };
  const reasoning = official && isReasoningModel(request.model);
  if (!reasoning) body.temperature = request.temperature;
  body[official ? 'max_completion_tokens' : 'max_tokens'] = request.maxTokens;
  if (request.tools?.length) {
    body.tools = request.tools.map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  return body;
}

/** Streams chat completions from OpenAI or any OpenAI-compatible server (Ollama, OpenRouter, Azure, …). */
export function createOpenAiStreamChat(official: boolean, providerLabel: string) {
  return async function* streamChat(request: ProviderRequest): AsyncGenerator<AiStreamEvent, void, undefined> {
    const doFetch = request.fetchImpl ?? fetch;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
    if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`;

    const response = await doFetch(joinUrl(request.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers,
      body: JSON.stringify(buildOpenAiBody(request, official)),
      signal: request.signal,
    });
    if (!response.ok) {
      throw describeHttpError(response.status, await response.text().catch(() => ''), providerLabel);
    }

    let stopReason: string | undefined;
    const pendingCalls = new Map<number, { id: string; name: string; args: string }>();
    for await (const message of parseSseStream(responseBodyChunks(response))) {
      if (message.data === '[DONE]') break;
      let chunk: OpenAiChunk;
      try {
        chunk = JSON.parse(message.data) as OpenAiChunk;
      } catch {
        continue;
      }
      if (chunk.error?.message) throw new AiProviderError(`${providerLabel}: ${chunk.error.message}`);
      const choice = chunk.choices?.[0];
      const text = choice?.delta?.content;
      if (text) yield { type: 'text-delta', text };
      for (const part of choice?.delta?.tool_calls ?? []) {
        const index = part.index ?? 0;
        const entry = pendingCalls.get(index) ?? { id: '', name: '', args: '' };
        if (part.id) entry.id = part.id;
        if (part.function?.name) entry.name += part.function.name;
        if (part.function?.arguments) entry.args += part.function.arguments;
        pendingCalls.set(index, entry);
      }
      if (choice?.finish_reason) stopReason = choice.finish_reason;
    }
    for (const [index, entry] of [...pendingCalls.entries()].sort((a, b) => a[0] - b[0])) {
      if (!entry.name) continue;
      yield { type: 'tool-call', call: parseToolArguments(entry.id || `call_${index}`, entry.name, entry.args) };
    }
    yield { type: 'done', stopReason };
  };
}

export const streamOpenAiChat = createOpenAiStreamChat(true, 'OpenAI');
export const streamOpenAiCompatibleChat = createOpenAiStreamChat(false, 'The AI server');

/** OpenAI's `/models` also lists embedding, audio, image and moderation models that can't chat. */
const NON_CHAT_OPENAI_MODEL =
  /(embedding|whisper|tts|dall-e|gpt-image|moderation|davinci|babbage|transcribe|realtime|audio|search|computer-use)/i;

/** Lists models from `GET {baseUrl}/models`; for official OpenAI, non-chat models are filtered out. */
export function createOpenAiListModels(official: boolean, providerLabel: string) {
  return async function listModels(request: ListModelsRequest): Promise<string[]> {
    const doFetch = request.fetchImpl ?? fetch;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (request.apiKey) headers.Authorization = `Bearer ${request.apiKey}`;
    const response = await doFetch(joinUrl(request.baseUrl, '/models'), {
      method: 'GET',
      headers,
      signal: request.signal,
    });
    if (!response.ok) {
      throw describeHttpError(response.status, await response.text().catch(() => ''), providerLabel);
    }
    const ids = parseModelIds(await response.json().catch(() => null));
    return (official ? ids.filter(id => !NON_CHAT_OPENAI_MODEL.test(id)) : ids).sort((a, b) => a.localeCompare(b));
  };
}

export const listOpenAiModels = createOpenAiListModels(true, 'OpenAI');
export const listOpenAiCompatibleModels = createOpenAiListModels(false, 'The AI server');
