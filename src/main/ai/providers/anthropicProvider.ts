import type { AiLlmMessage } from '../../../shared/aiTypes';
import { parseSseStream } from '../sseParser';
import {
  AiProviderError,
  describeHttpError,
  joinUrl,
  parseToolArguments,
  responseBodyChunks,
  type ProviderRequest,
  type ProviderStreamEvent,
} from './types';

export const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicEvent {
  type?: string;
  index?: number;
  content_block?: Record<string, unknown> & { type?: string; id?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    signature?: string;
    partial_json?: string;
    stop_reason?: string | null;
  };
  error?: { message?: string };
}

/** A content block being assembled from stream events; `json` holds a tool_use's partial input. */
type PendingBlock = Record<string, unknown> & { type?: string; json?: string };

/** Claude 4.7+ and the 5 family reject `temperature` (Sonnet/Haiku 5.5 accept only the default). */
export function acceptsSamplingParams(model: string): boolean {
  return !/^claude-(?:(?:opus|sonnet|haiku|fable|mythos)-(?:[5-9]|\d{2})|opus-4-[789])/i.test(model);
}

export const REFUSAL_NOTICE = '\n\n(Claude declined to answer this request.)';

type AnthropicBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}

/** Tool results must be grouped into a single user message that follows the assistant's tool_use turn. */
export function toAnthropicMessages(messages: AiLlmMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block: AnthropicBlock = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(b => b.type === 'tool_result')) {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'assistant' && m.providerContent?.length) {
      // Replay the turn exactly as streamed: thinking blocks must come back unchanged.
      out.push({ role: 'assistant', content: m.providerContent as AnthropicBlock[] });
    } else if (m.role === 'assistant' && m.toolCalls?.length) {
      const blocks: AnthropicBlock[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
      out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export function buildAnthropicBody(request: ProviderRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens,
    stream: true,
    system: request.system,
    messages: toAnthropicMessages(request.messages),
  };
  if (acceptsSamplingParams(request.model)) body.temperature = request.temperature;
  if (request.tools?.length) {
    body.tools = request.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  return body;
}

/** Streams a Claude response from the Anthropic Messages API. */
export async function* streamAnthropicChat(
  request: ProviderRequest,
): AsyncGenerator<ProviderStreamEvent, void, undefined> {
  const doFetch = request.fetchImpl ?? fetch;
  if (!request.apiKey) {
    throw new AiProviderError('No Anthropic API key is configured. Add one in AI settings.');
  }
  const response = await doFetch(joinUrl(request.baseUrl, '/messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'x-api-key': request.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(buildAnthropicBody(request)),
    signal: request.signal,
  });
  if (!response.ok) {
    throw describeHttpError(response.status, await response.text().catch(() => ''), 'Anthropic');
  }

  let stopReason: string | undefined;
  const blocks = new Map<number, PendingBlock>();
  for await (const message of parseSseStream(responseBodyChunks(response))) {
    let event: AnthropicEvent;
    try {
      event = JSON.parse(message.data) as AnthropicEvent;
    } catch {
      continue;
    }
    const index = event.index ?? 0;
    switch (event.type ?? message.event) {
      case 'content_block_start': {
        const start = event.content_block ?? {};
        const block: PendingBlock = { ...start };
        if (start.type === 'tool_use') {
          block.id = start.id ?? `toolu_${index}`;
          block.json = '';
        }
        blocks.set(index, block);
        break;
      }
      case 'content_block_delta': {
        const block = blocks.get(index);
        const delta = event.delta;
        if (delta?.type === 'text_delta' && delta.text) {
          if (block) block.text = `${(block.text as string | undefined) ?? ''}${delta.text}`;
          yield { type: 'text-delta', text: delta.text };
        } else if (block && delta?.type === 'input_json_delta') {
          block.json = `${block.json ?? ''}${delta.partial_json ?? ''}`;
        } else if (block && delta?.type === 'thinking_delta') {
          block.thinking = `${(block.thinking as string | undefined) ?? ''}${delta.thinking ?? ''}`;
        } else if (block && delta?.type === 'signature_delta') {
          block.signature = `${(block.signature as string | undefined) ?? ''}${delta.signature ?? ''}`;
        }
        break;
      }
      case 'content_block_stop': {
        const block = blocks.get(index);
        if (block?.type === 'tool_use') {
          const call = parseToolArguments(block.id as string, (block.name as string | undefined) ?? '', block.json ?? '');
          block.input = call.arguments;
          delete block.json;
          if (call.name) yield { type: 'tool-call', call };
        }
        break;
      }
      case 'message_delta':
        if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
        break;
      case 'error':
        throw new AiProviderError(`Anthropic: ${event.error?.message ?? 'stream error'}`);
      default:
        break;
    }
  }
  if (stopReason === 'refusal') yield { type: 'text-delta', text: REFUSAL_NOTICE };
  const content = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map(([, block]) => block);
  if (content.length > 0) yield { type: 'provider-content', content };
  yield { type: 'done', stopReason };
}
