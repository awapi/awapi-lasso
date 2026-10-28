import {
  AI_PROVIDERS,
  isAiProviderId,
  type AiChatMessage,
  type AiListModelsResult,
  type AiLlmMessage,
  type AiSendRequest,
  type AiSettings,
  type AiStreamEvent,
  type AiTestConnectionResult,
  type AiToolCall,
  type AiToolResult,
  type AiToolTranscriptMessage,
  type AiTurnEvent,
} from '../../shared/aiTypes';
import { AI_TOOLS, AI_TOOL_NAMES } from '../../shared/aiTools';
import { buildSystemPrompt, redactText, truncateText } from '../../shared/aiContext';
import type { SecretStoreDeps } from '../secretStore';
import { loadAiSettings, readAiKey, type AiSettingsFsDeps } from './aiSettingsStore';
import {
  AiProviderError,
  getListModels,
  getStreamChat,
  type ListModels,
  type ProviderRequest,
  type StreamChat,
} from './providers';

export const MAX_HISTORY_MESSAGES = 30;
export const MAX_MESSAGE_CHARS = 60000;
export const MAX_TOOL_ROUNDS = 8;
export const MAX_TOOL_RESULT_CHARS = 30000;
/** Tool exchanges are remembered for this many recent turns, with each result shortened to this size. */
export const MAX_REMEMBERED_TOOL_TURNS = 3;
export const MAX_REMEMBERED_TOOL_RESULT_CHARS = 4000;
const MAX_TRANSCRIPT_MESSAGES = 60;
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
  resolveListModels?: (provider: AiSettings['provider']) => ListModels;
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

/** provider|baseUrl|model combinations that rejected tool calling; later turns go straight to chat-only. */
const noToolSupport = new Set<string>();

export const CHAT_ONLY_NOTICE =
  "(This model doesn't support tool calling, so I can't read or edit your workspace. Answering from the shared context only.)\n\n";

const TOOLS_UNSUPPORTED_PATTERN =
  /(does ?n[o']t|do not|not|un)\s*support(ed)?\b.{0,60}\b(tools?|tool[ _]?(use|calling|calls|choice)|function[ _]?call(ing|s)?|functions)\b|\b(tools?|tool[ _]?(use|calling|choice)|function[ _]?call(ing|s)?|functions)\b.{0,60}\b(is|are)?\s*(not supported|unsupported)|tool[ _]?choice\b.{0,20}\brequires\b/i;

/** True when a provider rejected the request because the model or server cannot do tool calling. */
export function isToolsUnsupportedError(error: unknown): boolean {
  if (!(error instanceof AiProviderError)) return false;
  if (error.status !== undefined && ![400, 404, 405, 422, 500, 501].includes(error.status)) return false;
  return TOOLS_UNSUPPORTED_PATTERN.test(error.message);
}

/** Test helper: forget models remembered as not supporting tools. */
export function resetToolSupportCache(): void {
  noToolSupport.clear();
}

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks a renderer-supplied tool transcript: known tools, every call answered, nothing extra. Invalid → null. */
export function validateToolTranscript(raw: unknown): AiToolTranscriptMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TRANSCRIPT_MESSAGES) return null;
  const out: AiToolTranscriptMessage[] = [];
  let pending = new Set<string>();
  for (const m of raw as Array<Record<string, unknown>>) {
    if (m?.role === 'assistant') {
      if (pending.size > 0 || !Array.isArray(m.toolCalls) || m.toolCalls.length === 0) return null;
      const toolCalls: AiToolCall[] = [];
      for (const c of m.toolCalls as Array<Record<string, unknown>>) {
        if (typeof c?.id !== 'string' || c.id === '' || typeof c.name !== 'string' || !AI_TOOL_NAMES.has(c.name)) {
          return null;
        }
        toolCalls.push({ id: c.id, name: c.name, arguments: isPlainObject(c.arguments) ? c.arguments : {} });
      }
      pending = new Set(toolCalls.map(c => c.id));
      out.push({ role: 'assistant', content: typeof m.content === 'string' ? m.content : '', toolCalls });
    } else if (m?.role === 'tool') {
      if (typeof m.toolCallId !== 'string' || !pending.has(m.toolCallId) || typeof m.content !== 'string') return null;
      pending.delete(m.toolCallId);
      out.push({ role: 'tool', toolCallId: m.toolCallId, name: typeof m.name === 'string' ? m.name : '', content: m.content });
    } else {
      return null;
    }
  }
  return pending.size === 0 ? out : null;
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
    const transcript = m.role === 'assistant' ? validateToolTranscript(m.toolTranscript) : null;
    if (m.content.trim() === '' && !transcript) continue;
    cleaned.push({
      role: m.role,
      content: m.content.slice(0, MAX_MESSAGE_CHARS),
      ...(transcript ? { toolTranscript: transcript } : {}),
    });
  }
  const history = cleaned.slice(-MAX_HISTORY_MESSAGES);
  while (history.length > 0 && history[0].role !== 'user') history.shift();
  if (history.length === 0 || history[history.length - 1].role !== 'user') {
    throw new Error('The last message must be from the user.');
  }
  return history;
}

/**
 * Turns chat history into provider messages, re-inserting remembered tool exchanges for the most recent
 * turns (scrubbed again and shortened) so the model does not have to re-read what it already saw.
 */
export function expandHistory(history: AiChatMessage[], secrets: readonly string[]): AiLlmMessage[] {
  const assistantIndexes = history.flatMap((m, i) => (m.role === 'assistant' && m.toolTranscript ? [i] : []));
  const remembered = new Set(assistantIndexes.slice(-MAX_REMEMBERED_TOOL_TURNS));
  const out: AiLlmMessage[] = [];
  history.forEach((m, i) => {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
      return;
    }
    if (remembered.has(i) && m.toolTranscript) {
      for (const t of m.toolTranscript) {
        out.push(
          t.role === 'tool'
            ? { ...t, content: truncateText(redactText(t.content, secrets), MAX_REMEMBERED_TOOL_RESULT_CHARS) }
            : { role: 'assistant', content: t.content, toolCalls: t.toolCalls },
        );
      }
    }
    if (m.content.trim() !== '') out.push({ role: 'assistant', content: m.content });
  });
  return out;
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

    const toolKey = `${settings.provider}|${settings.baseUrls[settings.provider]}|${settings.models[settings.provider]}`;
    const wantsTools = request.toolsEnabled === true;
    let toolsEnabled = wantsTools && !noToolSupport.has(toolKey);
    const resolve = deps.resolveStreamChat ?? getStreamChat;
    const promptContext = request.context && { ...request.context, secretValues: secrets };
    let system = buildSystemPrompt(promptContext, toolsEnabled);
    const messages: AiLlmMessage[] = expandHistory(history, secrets);
    const turnStart = messages.length;
    let emittedText = false;
    /** Hands this turn's tool exchange to the renderer (results are already scrubbed; no provider internals). */
    const emitTranscript = () => {
      const transcript: AiToolTranscriptMessage[] = [];
      for (const m of messages.slice(turnStart)) {
        if (m.role === 'tool') {
          transcript.push(m);
        } else if (m.role === 'assistant' && m.toolCalls?.length) {
          // Intermediate text is already part of the visible answer, so it is not repeated here.
          const toolCalls = m.toolCalls.map(({ id, name, arguments: args }) => ({ id, name, arguments: args }));
          transcript.push({ role: 'assistant', content: '', toolCalls });
        }
      }
      if (transcript.length > 0) emit({ type: 'tool-transcript', messages: transcript });
    };
    if (wantsTools && !toolsEnabled) emit({ type: 'text-delta', text: CHAT_ONLY_NOTICE });

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
      } catch (error) {
        // Some models/servers reject the `tools` field outright; fall back to chat-only for this model.
        const nothingStreamed = round === 0 && !roundText && calls.length === 0;
        if (toolsEnabled && nothingStreamed && !controller.signal.aborted && isToolsUnsupportedError(error)) {
          noToolSupport.add(toolKey);
          toolsEnabled = false;
          system = buildSystemPrompt(promptContext, false);
          emit({ type: 'text-delta', text: CHAT_ONLY_NOTICE });
          round = -1;
          continue;
        }
        throw error;
      } finally {
        controller.signal.removeEventListener('abort', forwardAbort);
      }
      if (roundText) emittedText = true;

      if (calls.length === 0 || !toolsEnabled) {
        emitTranscript();
        emit({ type: 'done', stopReason });
        return;
      }
      if (round >= MAX_TOOL_ROUNDS) {
        emit({ type: 'text-delta', text: '\n\n(Stopped: too many tool steps in one turn.)' });
        emitTranscript();
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

export const LIST_MODELS_TIMEOUT_MS = 15000;

/** Lists the models of the saved provider. Best effort: the settings model field stays free text. */
export async function listAiModels(deps: Omit<AiServiceDeps, 'emit'>): Promise<AiListModelsResult> {
  const settings = loadAiSettings(deps.fsDeps);
  if (!isAiProviderId(settings.provider)) return { ok: false, message: 'Unknown provider.' };
  const info = AI_PROVIDERS[settings.provider];
  const apiKey = readAiKey(settings.provider, deps.secretDeps);
  if (!apiKey && !info.keyOptional) {
    return { ok: false, message: `No ${info.label} API key is configured.` };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIST_MODELS_TIMEOUT_MS);
  try {
    const resolve = deps.resolveListModels ?? getListModels;
    const models = await resolve(settings.provider)({
      apiKey,
      baseUrl: settings.baseUrls[settings.provider],
      signal: controller.signal,
      fetchImpl: deps.fetchImpl,
    });
    if (models.length === 0) return { ok: false, message: `${info.label} did not list any models.` };
    return { ok: true, models };
  } catch (error) {
    const message = controller.signal.aborted
      ? 'Listing models timed out.'
      : errorMessage(error, apiKey ? [apiKey] : []);
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
  }
}
