import {
  AI_PROVIDERS,
  isAiProviderId,
  type AiChatMessage,
  type AiLlmMessage,
  type AiSendRequest,
  type AiSettings,
  type AiStreamEvent,
  type AiTestConnectionResult,
  type AiToolCall,
  type AiToolResult,
  type AiTurnEvent,
} from '../../shared/aiTypes';
import { AI_TOOLS, AI_TOOL_NAMES } from '../../shared/aiTools';
import { buildSystemPrompt, redactText, truncateText } from '../../shared/aiContext';
import type { SecretStoreDeps } from '../secretStore';
import { loadAiSettings, readAiKey, type AiSettingsFsDeps } from './aiSettingsStore';
import { getStreamChat, type ProviderRequest, type StreamChat } from './providers';

export const MAX_HISTORY_MESSAGES = 30;
export const MAX_MESSAGE_CHARS = 60000;
export const MAX_TOOL_ROUNDS = 8;
export const MAX_TOOL_RESULT_CHARS = 30000;
/** Tool calls can wait on a user approval, so the timeout is generous. */
export const TOOL_RESULT_TIMEOUT_MS = 10 * 60 * 1000;
/** A provider stream that yields nothing for this long is treated as hung. Generous for slow local / reasoning models. */
export const PROVIDER_IDLE_TIMEOUT_MS = 3 * 60 * 1000;

export interface AiServiceDeps {
  fsDeps: AiSettingsFsDeps;
  secretDeps: SecretStoreDeps;
  emit: (event: AiTurnEvent) => void;
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  resolveStreamChat?: (provider: AiSettings['provider']) => StreamChat;
  toolTimeoutMs?: number;
  providerIdleTimeoutMs?: number;
  /** Secrets only Main knows (keychain values, cached OAuth 2.0 tokens), scrubbed from everything sent. */
  getMainSecretValues?: () => string[];
}

export class AiIdleTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`The AI provider stopped responding (no data for ${Math.round(timeoutMs / 1000)} s). Try again or check the server.`);
    this.name = 'AiIdleTimeoutError';
  }
}

/**
 * Re-yields `source`, failing with `AiIdleTimeoutError` when no event arrives within `timeoutMs`.
 * `onTimeout` should abort the underlying request so the stalled stream is released.
 */
export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  timeoutMs: number,
  onTimeout: () => void,
): AsyncGenerator<T, void, undefined> {
  const iterator = source[Symbol.asyncIterator]();
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new AiIdleTimeoutError(timeoutMs)), timeoutMs);
    });
    let next: IteratorResult<T>;
    try {
      next = await Promise.race([iterator.next(), timeout]);
    } catch (error) {
      if (error instanceof AiIdleTimeoutError) {
        onTimeout();
        // Don't await: a stalled generator only settles once the abort reaches it.
        void iterator.return?.()?.catch(() => {});
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (next.done) return;
    yield next.value;
  }
}

const activeTurns = new Map<string, AbortController>();

interface PendingToolCall {
  turnId: string;
  resolve: (result: AiToolResult) => void;
}
const pendingToolCalls = new Map<string, PendingToolCall>();

export function cancelAiTurn(turnId: string): boolean {
  const controller = activeTurns.get(turnId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Delivers a renderer-produced tool result to the waiting agent loop. Returns false if nothing was waiting. */
export function resolveAiToolResult(callId: unknown, result: unknown): boolean {
  if (typeof callId !== 'string') return false;
  const pending = pendingToolCalls.get(callId);
  if (!pending) return false;
  pendingToolCalls.delete(callId);
  const valid =
    typeof result === 'object' &&
    result !== null &&
    typeof (result as AiToolResult).ok === 'boolean' &&
    typeof (result as AiToolResult).content === 'string';
  pending.resolve(
    valid ? (result as AiToolResult) : { ok: false, content: 'The tool returned an invalid result.' },
  );
  return true;
}

export function validateMessages(messages: unknown): AiChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('No messages to send.');
  }
  const cleaned: AiChatMessage[] = [];
  for (const m of messages as Array<Partial<AiChatMessage>>) {
    if ((m?.role !== 'user' && m?.role !== 'assistant') || typeof m.content !== 'string') {
      throw new Error('Invalid chat message.');
    }
    if (m.content.trim() === '') continue;
    cleaned.push({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_CHARS) });
  }
  const history = cleaned.slice(-MAX_HISTORY_MESSAGES);
  while (history.length > 0 && history[0].role !== 'user') history.shift();
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    throw new Error('The last message must be from the user.');
  }
  return history;
}

function readMainSecrets(deps: AiServiceDeps): string[] {
  try {
    return deps.getMainSecretValues?.() ?? [];
  } catch {
    return [];
  }
}

function errorMessage(error: unknown, secrets: string[]): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactText(raw, secrets);
}

function resolveProviderRequest(
  settings: AiSettings,
  apiKey: string | null,
  system: string,
  messages: AiLlmMessage[],
  deps: AiServiceDeps,
  signal: AbortSignal,
  tools?: ProviderRequest['tools'],
): ProviderRequest {
  return {
    apiKey,
    baseUrl: settings.baseUrls[settings.provider],
    model: settings.models[settings.provider],
    system,
    messages,
    tools,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    signal,
    fetchImpl: deps.fetchImpl,
  };
}

/** Forwards a tool call to the renderer and waits for its result, which is scrubbed again here. */
async function requestToolResult(
  turnId: string,
  call: AiToolCall,
  emit: (event: AiStreamEvent) => void,
  signal: AbortSignal,
  secrets: string[],
  timeoutMs: number,
): Promise<AiToolResult> {
  if (!AI_TOOL_NAMES.has(call.name)) {
    return { ok: false, content: `Unknown tool "${call.name}".` };
  }
  if (call.argumentsError) {
    return { ok: false, content: call.argumentsError };
  }

  // Model-supplied ids are only unique per response, so the renderer round-trips a turn-scoped key.
  const callKey = `${turnId}::${call.id}`;
  const result = await new Promise<AiToolResult>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      pendingToolCalls.delete(callKey);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve({ ok: false, content: 'The tool did not respond in time.' });
    }, timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    pendingToolCalls.set(callKey, {
      turnId,
      resolve: value => {
        cleanup();
        resolve(value);
      },
    });
    emit({ type: 'tool-call', call: { ...call, id: callKey } });
  });

  return {
    ok: result.ok,
    content: truncateText(redactText(result.content, secrets), MAX_TOOL_RESULT_CHARS),
  };
}

/** Runs one chat turn (with tool rounds), emitting streamed events. Always ends with `done` or `error`. */
export async function runAiTurn(request: AiSendRequest, deps: AiServiceDeps): Promise<void> {
  const { turnId } = request;
  const emit = (event: AiStreamEvent) => deps.emit({ turnId, event });
  const controller = new AbortController();
  activeTurns.set(turnId, controller);
  let secrets: string[] = request.context?.secretValues ?? [];

  try {
    const history = validateMessages(request.messages);
    const settings = loadAiSettings(deps.fsDeps);
    const info = AI_PROVIDERS[settings.provider];
    const apiKey = readAiKey(settings.provider, deps.secretDeps);
    secrets = [...secrets, ...readMainSecrets(deps), ...(apiKey ? [apiKey] : [])];
    if (!apiKey && !info.keyOptional) {
      throw new Error(`No ${info.label} API key is configured. Add one in AI settings.`);
    }

    const toolsEnabled = request.toolsEnabled === true;
    const resolve = deps.resolveStreamChat ?? getStreamChat;
    const system = buildSystemPrompt(request.context && { ...request.context, secretValues: secrets }, toolsEnabled);
    const messages: AiLlmMessage[] = [...history];
    let emittedText = false;

    for (let round = 0; ; round++) {
      // Per-round controller so an idle timeout can abort the HTTP stream without cancelling the turn.
      const roundController = new AbortController();
      const forwardAbort = () => roundController.abort();
      controller.signal.addEventListener('abort', forwardAbort, { once: true });
      const providerRequest = resolveProviderRequest(
        settings,
        apiKey,
        system,
        messages,
        deps,
        roundController.signal,
        toolsEnabled ? AI_TOOLS : undefined,
      );
      let roundText = '';
      let stopReason: string | undefined;
      const calls: AiToolCall[] = [];
      let providerContent: unknown[] | undefined;
      const stream = withIdleTimeout(
        resolve(settings.provider)(providerRequest),
        deps.providerIdleTimeoutMs ?? PROVIDER_IDLE_TIMEOUT_MS,
        forwardAbort,
      );
      try {
        for await (const event of stream) {
          if (event.type === 'text-delta') {
            if (!roundText && emittedText) emit({ type: 'text-delta', text: '\n\n' });
            roundText += event.text;
            emit(event);
          } else if (event.type === 'tool-call') {
            calls.push(event.call);
          } else if (event.type === 'provider-content') {
            providerContent = event.content;
          } else if (event.type === 'done') {
            stopReason = event.stopReason;
          } else {
            emit(event);
          }
        }
      } finally {
        controller.signal.removeEventListener('abort', forwardAbort);
      }
      if (roundText) emittedText = true;

      if (calls.length === 0 || !toolsEnabled) {
        emit({ type: 'done', stopReason });
        return;
      }
      if (round >= MAX_TOOL_ROUNDS) {
        emit({ type: 'text-delta', text: '\n\n(Stopped: too many tool steps in one turn.)' });
        emit({ type: 'done', stopReason: 'max_tool_rounds' });
        return;
      }

      messages.push({
        role: 'assistant',
        content: roundText,
        toolCalls: calls,
        ...(providerContent ? { providerContent } : {}),
      });
      for (const call of calls) {
        const result = await requestToolResult(
          turnId,
          call,
          emit,
          controller.signal,
          secrets,
          deps.toolTimeoutMs ?? TOOL_RESULT_TIMEOUT_MS,
        );
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result.content });
      }
    }
  } catch (error) {
    if (controller.signal.aborted) {
      emit({ type: 'done', stopReason: 'cancelled' });
    } else {
      emit({
        type: 'error',
        message: errorMessage(error, secrets),
      });
    }
  } finally {
    activeTurns.delete(turnId);
    for (const [callId, pending] of pendingToolCalls) {
      if (pending.turnId === turnId) pendingToolCalls.delete(callId);
    }
  }
}

/** Sends a tiny prompt to verify the saved provider, model, base URL and key work. */
export async function testAiConnection(deps: Omit<AiServiceDeps, 'emit'>): Promise<AiTestConnectionResult> {
  const settings = loadAiSettings(deps.fsDeps);
  if (!isAiProviderId(settings.provider)) return { ok: false, message: 'Unknown provider.' };
  const info = AI_PROVIDERS[settings.provider];
  const apiKey = readAiKey(settings.provider, deps.secretDeps);
  if (!apiKey && !info.keyOptional) {
    return { ok: false, message: `No ${info.label} API key is configured.` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const request = resolveProviderRequest(
      { ...settings, maxTokens: 16 },
      apiKey,
      'Reply with the single word OK.',
      [{ role: 'user', content: 'ping' }],
      { ...deps, emit: () => {} },
      controller.signal,
    );
    const resolve = deps.resolveStreamChat ?? getStreamChat;
    let received = false;
    for await (const event of resolve(settings.provider)(request)) {
      if (event.type === 'text-delta') received = true;
    }
    return {
      ok: true,
      message: received
        ? `Connected to ${info.label} using ${settings.models[settings.provider]}.`
        : `Connected to ${info.label}.`,
    };
  } catch (error) {
    const message = controller.signal.aborted
      ? 'Connection timed out.'
      : errorMessage(error, apiKey ? [apiKey] : []);
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }
}
