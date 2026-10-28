export type AiProviderId = 'openai' | 'anthropic' | 'openai-compatible';

export const AI_PROVIDER_IDS: readonly AiProviderId[] = ['openai', 'anthropic', 'openai-compatible'];

export interface AiProviderInfo {
  id: AiProviderId;
  label: string;
  defaultModel: string;
  defaultBaseUrl: string;
  /** Local/compatible servers (e.g. Ollama) may not need an API key. */
  keyOptional: boolean;
}

export const AI_PROVIDERS: Record<AiProviderId, AiProviderInfo> = {
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyOptional: false,
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-opus-5-5',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    keyOptional: false,
  },
  'openai-compatible': {
    id: 'openai-compatible',
    label: 'OpenAI-compatible (Ollama, OpenRouter, Azure…)',
    defaultModel: 'llama3.1',
    defaultBaseUrl: 'http://localhost:11434/v1',
    keyOptional: true,
  },
};

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === 'string' && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Non-secret AI configuration persisted in app data. API keys live only in the OS Keychain. */
export interface AiSettings {
  provider: AiProviderId;
  /** Model per provider so switching providers does not lose the selection. */
  models: Record<AiProviderId, string>;
  /** Base URL per provider (only meaningful to override for OpenAI-compatible). */
  baseUrls: Record<AiProviderId, string>;
  temperature: number;
  maxTokens: number;
  /** Ask before the assistant runs requests on the user's behalf. */
  confirmBeforeRun: boolean;
  /** Apply assistant edits (requests, environments, collections) without asking first. */
  autoApplyEdits: boolean;
  /** Let the assistant read non-secret environment variable values (names are always shared). */
  shareEnvironmentValues: boolean;
}

/** Leaves room for reasoning: thinking models spend output tokens before they answer. */
export const DEFAULT_AI_MAX_TOKENS = 8192;
export const DEFAULT_AI_TEMPERATURE = 0.2;

export function createDefaultAiSettings(): AiSettings {
  return {
    provider: 'openai',
    models: {
      openai: AI_PROVIDERS.openai.defaultModel,
      anthropic: AI_PROVIDERS.anthropic.defaultModel,
      'openai-compatible': AI_PROVIDERS['openai-compatible'].defaultModel,
    },
    baseUrls: {
      openai: AI_PROVIDERS.openai.defaultBaseUrl,
      anthropic: AI_PROVIDERS.anthropic.defaultBaseUrl,
      'openai-compatible': AI_PROVIDERS['openai-compatible'].defaultBaseUrl,
    },
    temperature: DEFAULT_AI_TEMPERATURE,
    maxTokens: DEFAULT_AI_MAX_TOKENS,
    confirmBeforeRun: true,
    autoApplyEdits: false,
    shareEnvironmentValues: true,
  };
}

export type AiChatRole = 'user' | 'assistant';

/** Tool calls and their (already scrubbed) results from one finished turn, remembered for later turns. */
export type AiToolTranscriptMessage =
  | { role: 'assistant'; content: string; toolCalls: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
  /** On assistant messages: the tool exchange that preceded this answer. */
  toolTranscript?: AiToolTranscriptMessage[];
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Set when the model produced arguments that were not valid JSON. */
  argumentsError?: string;
}

/** Provider-level message, including tool-call turns that exist only inside a single chat turn. */
export type AiLlmMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: AiToolCall[];
      /**
       * The provider's raw content blocks for this turn (e.g. Anthropic thinking blocks with signatures),
       * replayed unchanged on the next tool round. Main-process only; never sent to the renderer.
       */
      providerContent?: unknown[];
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type AiToolRisk = 'read' | 'write' | 'run';

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema (object) describing the arguments. */
  parameters: Record<string, unknown>;
  /** `write` and `run` tools need user approval unless the matching setting is off. */
  risk: AiToolRisk;
}

export interface AiToolResult {
  ok: boolean;
  /** Text returned to the model. Already sanitized in the renderer and scrubbed again in Main. */
  content: string;
}

/** Raw (un-redacted) workspace context captured by the renderer; redacted in the Main process before use. */
export interface AiChatContext {
  request?: {
    name?: string;
    protocol?: string;
    method?: string;
    url?: string;
    headers?: Array<{ key: string; value?: string; enabled?: boolean }>;
    queryParams?: Array<{ key: string; value?: string; enabled?: boolean }>;
    bodyMode?: string;
    body?: string;
    graphqlQuery?: string;
    graphqlVariables?: string;
  };
  response?: {
    status?: number;
    statusText?: string;
    ok?: boolean;
    error?: string;
    timedOut?: boolean;
    finalUrl?: string;
    contentType?: string;
    headers?: Record<string, string>;
    body?: string;
    sizeBytes?: number;
    totalMs?: number;
  };
  /** GraphQL schema SDL (already trimmed by the caller where possible). */
  graphqlSchemaSdl?: string;
  /** Names of variables in the active environment (never values). */
  environmentVariableNames?: string[];
  /** Plaintext values known to be secret; scrubbed from everything sent to the model. */
  secretValues?: string[];
}

export interface AiSendRequest {
  turnId: string;
  messages: AiChatMessage[];
  context?: AiChatContext;
  /** The renderer can execute workspace tools; when false the assistant is chat-only. */
  toolsEnabled?: boolean;
}

export type AiStreamEvent =
  | { type: 'text-delta'; text: string }
  /** The model wants a workspace tool run; the renderer executes it and replies with `aiToolResult`. */
  | { type: 'tool-call'; call: AiToolCall }
  /** Sent once at the end of a turn that used tools so the renderer can send it back with later turns. */
  | { type: 'tool-transcript'; messages: AiToolTranscriptMessage[] }
  | { type: 'done'; stopReason?: string }
  | { type: 'error'; message: string };

export interface AiTurnEvent {
  turnId: string;
  event: AiStreamEvent;
}

export interface AiKeyStatus {
  provider: AiProviderId;
  hasKey: boolean;
}

export interface AiTestConnectionResult {
  ok: boolean;
  message: string;
}

/** Models offered by the configured provider (best effort; the model field stays free text). */
export type AiListModelsResult = { ok: true; models: string[] } | { ok: false; message: string };
