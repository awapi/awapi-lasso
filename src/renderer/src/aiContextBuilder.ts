import type {
  AuthConfig,
  AwjcCollection,
  CollectionTreeItem,
  EnvironmentConfig,
  KeyValueEntry,
  RequestItem,
  VariableEntry,
} from '../../shared/collectionSchema';
import { REDACTED } from '../../shared/aiContext';
import { isEntryHiddenFromAi } from '../../shared/aiSanitize';
import type { AiChatContext } from '../../shared/aiTypes';
import type { HttpResponseResult } from '../../shared/httpTypes';

const TEMPLATE_ONLY = /^\{\{[^}]+\}\}$/;

function addSecret(target: Set<string>, value: string | undefined): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  if (trimmed.length === 0 || TEMPLATE_ONLY.test(trimmed)) return;
  target.add(value);
}

/** Collects literal credential values from an auth block so they can be scrubbed before reaching an LLM. */
export function collectAuthSecretValues(auth: AuthConfig | undefined): string[] {
  const secrets = new Set<string>();
  if (!auth) return [];
  addSecret(secrets, auth.bearer?.token);
  addSecret(secrets, auth.basic?.password);
  addSecret(secrets, auth.apikey?.value);
  addSecret(secrets, auth.digest?.password);
  addSecret(secrets, auth.awsv4?.secretAccessKey);
  addSecret(secrets, auth.awsv4?.sessionToken);
  addSecret(secrets, auth.oauth2?.clientSecret);
  addSecret(secrets, auth.oauth2?.password);
  addSecret(secrets, auth.oauth2?.refreshToken);
  return [...secrets];
}

export interface BuildAiChatContextInput {
  request?: RequestItem | null;
  response?: HttpResponseResult | null;
  environment?: EnvironmentConfig | null;
  collectionVariables?: VariableEntry[];
  /** Extra plaintext secrets known to the caller (e.g. inherited auth or resolved keychain values). */
  extraSecretValues?: string[];
  graphqlSchemaSdl?: string;
}

function maskEntries(entries: KeyValueEntry[] | undefined) {
  return entries?.map(e => ({
    key: e.key,
    value: isEntryHiddenFromAi(e) ? REDACTED : e.value,
    enabled: e.enabled,
  }));
}

function describeBody(request: RequestItem): { bodyMode?: string; body?: string } {
  const body = request.body;
  if (!body || body.mode === 'none') return {};
  if (body.mode === 'form-urlencoded') {
    const pairs = (body.urlEncoded ?? [])
      .filter(e => e.enabled && e.key)
      .map(e => `${e.key}=${isEntryHiddenFromAi(e) ? REDACTED : (e.value ?? '')}`);
    return { bodyMode: body.mode, body: pairs.join('&') };
  }
  if (body.mode === 'multipart-form') {
    const pairs = (body.formData ?? [])
      .filter(e => e.key)
      .map(e => `${e.key}=${e.type === 'file' ? `<file ${e.filePath ?? ''}>` : (e.value ?? '')}`);
    return { bodyMode: body.mode, body: pairs.join('\n') };
  }
  if (body.mode === 'binary') return { bodyMode: body.mode, body: `<binary file ${body.binaryFilePath ?? ''}>` };
  return { bodyMode: body.mode, body: body.content };
}

/**
 * Builds the raw chat context from workspace state. Requests stay in their templated `{{variable}}`
 * form; secret values are listed only so the Main process can scrub them from everything it sends.
 */
export function buildAiChatContext(input: BuildAiChatContextInput): AiChatContext {
  const { request, response, environment, collectionVariables = [], extraSecretValues = [] } = input;
  const secrets = new Set<string>();
  for (const v of [...(environment?.variables ?? []), ...collectionVariables]) {
    if (v.secret || v.hideFromAi) addSecret(secrets, v.value);
  }
  for (const v of collectAuthSecretValues(request?.auth)) addSecret(secrets, v);
  if (request) collectItemSecrets(secrets, [request]);
  for (const v of extraSecretValues) addSecret(secrets, v);

  const context: AiChatContext = { secretValues: [...secrets] };

  if (request) {
    const isGraphql = request.protocol === 'graphql' && request.graphql;
    context.request = {
      name: request.name,
      protocol: request.protocol,
      method: request.method,
      url: request.url,
      headers: maskEntries(request.headers),
      queryParams: maskEntries(request.queryParams),
      ...(isGraphql
        ? { graphqlQuery: request.graphql?.query, graphqlVariables: request.graphql?.variables }
        : describeBody(request)),
    };
  }

  if (response) {
    context.response = {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      error: response.error,
      timedOut: response.timedOut,
      finalUrl: response.finalUrl,
      contentType: response.contentType,
      headers: response.headers,
      body: response.isBinary ? '<binary body omitted>' : response.body,
      sizeBytes: response.sizeBytes,
      totalMs: response.timings?.totalMs,
    };
  }

  const names = [...(environment?.variables ?? []), ...collectionVariables]
    .filter(v => v.enabled && v.key)
    .map(v => v.key);
  if (names.length > 0) context.environmentVariableNames = [...new Set(names)];
  if (input.graphqlSchemaSdl) context.graphqlSchemaSdl = input.graphqlSchemaSdl;
  return context;
}

function addHiddenEntries(target: Set<string>, entries: Array<KeyValueEntry | VariableEntry> | undefined): void {
  for (const e of entries ?? []) {
    if (isEntryHiddenFromAi(e)) addSecret(target, e.value);
  }
}

function collectItemSecrets(target: Set<string>, items: CollectionTreeItem[]): void {
  for (const item of items) {
    for (const v of collectAuthSecretValues(item.auth)) addSecret(target, v);
    if (item.kind === 'folder') {
      addHiddenEntries(target, item.headers);
      addHiddenEntries(target, item.variables);
      collectItemSecrets(target, item.items);
    } else {
      addHiddenEntries(target, item.headers);
      addHiddenEntries(target, item.queryParams);
      addHiddenEntries(target, item.body?.urlEncoded);
    }
  }
}

export interface WorkspaceSecretSources {
  collections: Array<{ collection: AwjcCollection }>;
  tabs?: Array<{ request: RequestItem }>;
  capturedVars?: VariableEntry[];
}

/**
 * Every plaintext secret the renderer knows about (credentials, secret and hide-from-AI values, credential-like headers).
 * Used only to scrub assistant-visible output; it is never shown to the model.
 */
export function collectWorkspaceSecretValues(sources: WorkspaceSecretSources): string[] {
  const secrets = new Set<string>();
  for (const { collection } of sources.collections) {
    for (const env of collection.environments ?? []) addHiddenEntries(secrets, env.variables);
    addHiddenEntries(secrets, collection.variables);
    addHiddenEntries(secrets, collection.defaults?.headers);
    for (const v of collectAuthSecretValues(collection.defaults?.auth)) addSecret(secrets, v);
    for (const profile of collection.authProfiles ?? []) {
      for (const v of collectAuthSecretValues(profile)) addSecret(secrets, v);
    }
    collectItemSecrets(secrets, collection.items);
  }
  for (const tab of sources.tabs ?? []) collectItemSecrets(secrets, [tab.request]);
  addHiddenEntries(secrets, sources.capturedVars);
  return [...secrets];
}
