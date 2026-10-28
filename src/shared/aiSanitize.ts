import {
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
  type AssertionRule,
  type AwjcCollection,
  type CaptureRule,
  type CollectionTreeItem,
  type KeyValueEntry,
  type RequestItem,
  type VariableEntry,
} from './collectionSchema';
import type { HttpResponseResult } from './httpTypes';
import type { VariableInterpolationContext } from './interpolation';
import { buildResolvedRequestUrl } from './urlParams';
import {
  REDACTED,
  findLiteralSecret,
  isSensitiveName,
  redactHeaderValue,
  redactText,
  redactUrl,
  truncateText,
} from './aiContext';

export const MAX_TOOL_BODY_CHARS = 20000;
export const DEFAULT_RESPONSE_PAGE_CHARS = 8000;
export const MAX_TREE_NODES = 300;

const BODY_MODES = ['none', 'json', 'yaml', 'xml', 'html', 'text', 'form-urlencoded'] as const;
const CAPTURE_SCOPES = ['environment', 'collection', 'runtime'] as const;
const CAPTURE_SOURCES = ['jsonpath', 'header', 'cookie', 'status', 'body'] as const;
const ASSERTION_TARGETS = ['status', 'responseTime', 'header', 'jsonpath', 'body'] as const;
const ASSERTION_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'matchesRegex',
  'lessThan',
  'greaterThan',
  'in',
  'isDefined',
  'isUndefined',
  'isEmpty',
  'isNotEmpty',
  'isArray',
] as const;
const REQUEST_CHANGE_KEYS = new Set([
  'name',
  'description',
  'method',
  'url',
  'queryParams',
  'pathParams',
  'headers',
  'body',
  'graphql',
  'captures',
  'assertions',
]);

export type AiResult<T> = { ok: true; value: T; summary: string[] } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** True when a value holds no literal credential: empty, or only `{{variable}}` references (+ a scheme word). */
export function isSafeCredentialValue(value: string): boolean {
  const remainder = value.replace(/\{\{[^}]+\}\}/g, '').trim();
  return remainder === '' || /^(Bearer|Basic|Token|Digest)$/i.test(remainder);
}

/** Whether the assistant must not see this value: flagged secret, or a credential-looking name with a literal value. */
export function isHiddenValue(key: string, value: string | undefined, flaggedSecret?: boolean): boolean {
  if (value === undefined || value === '') return false;
  return Boolean(flaggedSecret) || (isSensitiveName(key) && !isSafeCredentialValue(value));
}

/** An entry the assistant must not see: `secret`, `hideFromAi`, or a credential-looking name with a literal value. */
export function isEntryHiddenFromAi(entry: {
  key: string;
  value?: string;
  secret?: boolean;
  hideFromAi?: boolean;
}): boolean {
  return isHiddenValue(entry.key, entry.value, entry.secret || entry.hideFromAi);
}

function maskValue(key: string, value: string | undefined, secrets: readonly string[], flagged?: boolean) {
  if (value === undefined) return undefined;
  return isHiddenValue(key, value, flagged) ? REDACTED : redactText(value, secrets);
}

function sanitizeEntries(entries: KeyValueEntry[] | undefined, secrets: readonly string[]) {
  return (entries ?? []).map(e => ({
    key: e.key,
    value: maskValue(e.key, e.value, secrets, e.secret || e.hideFromAi),
    enabled: e.enabled,
    ...(e.description ? { description: e.description } : {}),
  }));
}

function sanitizeBodyText(text: string | undefined, secrets: readonly string[]): string | undefined {
  if (text === undefined) return undefined;
  return redactText(truncateText(text, MAX_TOOL_BODY_CHARS), secrets);
}

/** The assistant's view of a request. Auth is reduced to its type; hidden values show as [REDACTED]. */
export function sanitizeRequestForAi(request: RequestItem, secrets: readonly string[] = []) {
  const body = request.body;
  return {
    id: request.id,
    name: request.name,
    ...(request.description ? { description: request.description } : {}),
    protocol: request.protocol,
    method: request.method,
    url: redactUrl(request.url, secrets),
    queryParams: sanitizeEntries(request.queryParams, secrets),
    pathParams: (request.pathParams ?? []).map(p => ({
      key: p.key,
      value: maskValue(p.key, p.value, secrets, p.secret),
    })),
    headers: sanitizeEntries(request.headers, secrets),
    body: body
      ? {
          mode: body.mode,
          content: sanitizeBodyText(body.content, secrets),
          urlEncoded: body.urlEncoded ? sanitizeEntries(body.urlEncoded, secrets) : undefined,
          formData: body.formData?.map(f => ({
            key: f.key,
            type: f.type,
            value: f.type === 'file' ? undefined : maskValue(f.key, f.value, secrets),
            filePath: f.filePath,
          })),
        }
      : { mode: 'none' },
    ...(request.graphql
      ? {
          graphql: {
            query: sanitizeBodyText(request.graphql.query, secrets),
            variables: sanitizeBodyText(request.graphql.variables, secrets),
            operationName: request.graphql.operationName,
          },
        }
      : {}),
    captures: request.captures ?? [],
    assertions: request.assertions ?? [],
    authType: request.auth?.type ?? 'inherit',
  };
}

export interface ResponsePageOptions {
  offset?: number;
  maxChars?: number;
}

/** The assistant's view of a response. Sent headers, cookie values and credentials are never included. */
export function sanitizeResponseForAi(
  response: HttpResponseResult,
  secrets: readonly string[] = [],
  page: ResponsePageOptions = {},
) {
  const maxChars = Math.min(
    Math.max(Math.trunc(page.maxChars ?? DEFAULT_RESPONSE_PAGE_CHARS), 1),
    MAX_TOOL_BODY_CHARS,
  );
  const offset = Math.max(Math.trunc(page.offset ?? 0), 0);
  const fullBody = response.isBinary ? '' : redactText(response.body ?? '', secrets);
  const slice = fullBody.slice(offset, offset + maxChars);
  const nextOffset = offset + maxChars < fullBody.length ? offset + maxChars : null;

  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    ...(response.error ? { error: redactText(response.error, secrets) } : {}),
    ...(response.timedOut ? { timedOut: true } : {}),
    method: response.method,
    finalUrl: redactUrl(response.finalUrl ?? '', secrets),
    httpVersion: response.httpVersion,
    contentType: response.contentType,
    sizeBytes: response.sizeBytes,
    timings: response.timings,
    headers: Object.fromEntries(
      Object.entries(response.headers ?? {}).map(([k, v]) => [k, redactHeaderValue(k, v, secrets)]),
    ),
    cookieNames: (response.cookies ?? []).map(c => c.name),
    redirectCount: response.redirects?.length ?? 0,
    body: response.isBinary ? '<binary body omitted>' : slice,
    bodyLength: fullBody.length,
    bodyOffset: offset,
    nextOffset,
    captures: (response.captures ?? []).map(c => ({
      variable: c.variable,
      matched: c.matched,
      value: c.value === null ? null : maskValue(c.variable, c.value, secrets, c.secret),
      ...(c.error ? { error: c.error } : {}),
    })),
    assertions: (response.assertions ?? []).map(a => ({
      target: a.rule.target,
      operator: a.rule.operator,
      path: a.rule.path,
      headerName: a.rule.headerName,
      passed: a.passed,
      message: redactText(String(a.message ?? ''), secrets).slice(0, 300),
    })),
  };
}

export function sanitizeVariablesForAi(
  variables: VariableEntry[] | undefined,
  secrets: readonly string[] = [],
  options: { hideAllValues?: boolean } = {},
) {
  return (variables ?? []).map(v => {
    const hidden = Boolean(v.secret) || isEntryHiddenFromAi(v);
    return {
      key: v.key,
      enabled: v.enabled,
      secret: Boolean(v.secret) || hidden,
      value:
        hidden || options.hideAllValues || v.value === undefined ? undefined : redactText(v.value, secrets),
      ...(v.description ? { description: v.description } : {}),
    };
  });
}

export interface AiTreeNode {
  kind: 'folder' | 'request';
  id: string;
  name: string;
  method?: string;
  protocol?: string;
  url?: string;
  items?: AiTreeNode[];
}

/** Collection outline without auth, folder headers or variables. Capped to keep results small. */
export function describeTreeForAi(
  items: CollectionTreeItem[],
  secrets: readonly string[] = [],
): { nodes: AiTreeNode[]; truncated: boolean } {
  let count = 0;
  let truncated = false;
  const walk = (list: CollectionTreeItem[]): AiTreeNode[] => {
    const out: AiTreeNode[] = [];
    for (const item of list) {
      if (count >= MAX_TREE_NODES) {
        truncated = true;
        break;
      }
      count += 1;
      if (item.kind === 'folder') {
        out.push({ kind: 'folder', id: item.id, name: item.name, items: walk(item.items) });
      } else {
        out.push({
          kind: 'request',
          id: item.id,
          name: item.name,
          method: item.method,
          protocol: item.protocol,
          url: redactUrl(item.url, secrets),
        });
      }
    }
    return out;
  };
  return { nodes: walk(items), truncated };
}

// ---------- Writes ----------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkText(label: string, value: unknown, max = 200000): string | null {
  if (typeof value !== 'string') return `${label} must be a string.`;
  if (value.length > max) return `${label} is too long.`;
  if (value.includes(REDACTED)) {
    return `${label} contains the ${REDACTED} placeholder. Hidden values cannot be written back; use a {{variable}} reference or leave that field unchanged.`;
  }
  const secretKind = findLiteralSecret(value);
  if (secretKind) {
    return `${label} contains what looks like a literal ${secretKind}. Credentials cannot be written by the assistant; use a {{variable}} reference instead.`;
  }
  return null;
}

type IncomingEntry = Omit<KeyValueEntry, 'enabled'> & { enabled?: boolean };

function parseEntries(label: string, raw: unknown): AiResult<IncomingEntry[]> {
  if (!Array.isArray(raw)) return fail(`${label}.set must be an array.`);
  const entries: IncomingEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.key !== 'string' || item.key.trim() === '') {
      return fail(`Each ${label} entry needs a non-empty string "key".`);
    }
    const key = item.key.trim();
    const entry: IncomingEntry = { key };
    if (item.enabled !== undefined) entry.enabled = item.enabled === true;
    if (item.value !== undefined) {
      const err = checkText(`${label} "${key}" value`, item.value);
      if (err) return fail(err);
      if (isSensitiveName(key) && !isSafeCredentialValue(item.value as string)) {
        return fail(
          `"${key}" looks like a credential. Credentials cannot be written by the assistant; use a {{variable}} reference as the value.`,
        );
      }
      entry.value = item.value as string;
    }
    if (typeof item.description === 'string') entry.description = item.description;
    entries.push(entry);
  }
  return { ok: true, value: entries, summary: [] };
}

function applyPatch(
  label: string,
  existing: KeyValueEntry[] | undefined,
  raw: unknown,
  caseInsensitive: boolean,
): AiResult<KeyValueEntry[]> {
  if (!isRecord(raw)) return fail(`${label} must be an object with "set" and/or "remove".`);
  const norm = (k: string) => (caseInsensitive ? k.toLowerCase() : k);
  let result = [...(existing ?? [])];
  const summary: string[] = [];

  if (raw.remove !== undefined) {
    if (!Array.isArray(raw.remove) || raw.remove.some(k => typeof k !== 'string')) {
      return fail(`${label}.remove must be an array of keys.`);
    }
    const remove = new Set((raw.remove as string[]).map(norm));
    result = result.filter(e => !remove.has(norm(e.key)));
    for (const key of raw.remove as string[]) summary.push(`Remove ${label}: ${key}`);
  }
  if (raw.set !== undefined) {
    const parsed = parseEntries(label, raw.set);
    if (!parsed.ok) return parsed;
    for (const incoming of parsed.value) {
      const idx = result.findIndex(e => norm(e.key) === norm(incoming.key));
      if (idx >= 0) {
        const current = result[idx];
        if (
          incoming.value !== undefined &&
          (current.secret || current.hideFromAi) &&
          !isSafeCredentialValue(incoming.value)
        ) {
          return fail(`"${incoming.key}" holds a hidden value and cannot be overwritten by the assistant.`);
        }
        result[idx] = {
          ...current,
          ...(incoming.value !== undefined ? { value: incoming.value } : {}),
          ...(incoming.enabled !== undefined ? { enabled: incoming.enabled } : {}),
          ...(incoming.description !== undefined ? { description: incoming.description } : {}),
        };
      } else {
        result.push({ ...incoming, enabled: incoming.enabled ?? true });
      }
      summary.push(`Set ${label}: ${incoming.key}${incoming.value !== undefined ? ` = ${incoming.value}` : ''}`);
    }
  }
  return { ok: true, value: result, summary };
}

function oneOf<T extends string>(label: string, value: unknown, allowed: readonly T[]): string | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? null
    : `${label} must be one of: ${allowed.join(', ')}.`;
}

function parseCaptures(raw: unknown): AiResult<CaptureRule[]> {
  if (!Array.isArray(raw)) return fail('captures must be an array.');
  const out: CaptureRule[] = [];
  for (const c of raw) {
    if (!isRecord(c) || typeof c.variable !== 'string' || c.variable.trim() === '') {
      return fail('Each capture needs a "variable" name.');
    }
    const err = oneOf('capture scope', c.scope, CAPTURE_SCOPES) ?? oneOf('capture source', c.source, CAPTURE_SOURCES);
    if (err) return fail(err);
    if (c.expression !== undefined && typeof c.expression !== 'string') return fail('capture expression must be a string.');
    out.push({
      variable: c.variable.trim(),
      scope: c.scope as CaptureRule['scope'],
      source: c.source as CaptureRule['source'],
      ...(c.expression !== undefined ? { expression: c.expression as string } : {}),
      enabled: c.enabled === undefined ? true : c.enabled === true,
    });
  }
  return { ok: true, value: out, summary: [] };
}

function parseAssertions(raw: unknown): AiResult<AssertionRule[]> {
  if (!Array.isArray(raw)) return fail('assertions must be an array.');
  const out: AssertionRule[] = [];
  for (const a of raw) {
    if (!isRecord(a)) return fail('Each assertion must be an object.');
    const err =
      oneOf('assertion target', a.target, ASSERTION_TARGETS) ?? oneOf('assertion operator', a.operator, ASSERTION_OPERATORS);
    if (err) return fail(err);
    for (const k of ['path', 'headerName'] as const) {
      if (a[k] !== undefined && typeof a[k] !== 'string') return fail(`assertion ${k} must be a string.`);
    }
    const expected = a.expected;
    const validExpected =
      expected === undefined ||
      typeof expected === 'string' ||
      typeof expected === 'number' ||
      typeof expected === 'boolean' ||
      (Array.isArray(expected) && expected.every(x => typeof x === 'string' || typeof x === 'number'));
    if (!validExpected) return fail('assertion expected must be a string, number, boolean, or array of strings/numbers.');
    out.push({
      target: a.target as AssertionRule['target'],
      operator: a.operator as AssertionRule['operator'],
      ...(a.path !== undefined ? { path: a.path as string } : {}),
      ...(a.headerName !== undefined ? { headerName: a.headerName as string } : {}),
      ...(expected !== undefined ? { expected: expected as AssertionRule['expected'] } : {}),
      enabled: a.enabled === undefined ? true : a.enabled === true,
    });
  }
  return { ok: true, value: out, summary: [] };
}

/** Applies assistant-proposed edits to a request. Auth is not editable and credentials must be `{{variables}}`. */
export function applyRequestChanges(request: RequestItem, changes: unknown): AiResult<RequestItem> {
  if (!isRecord(changes)) return fail('"changes" must be an object.');
  const keys = Object.keys(changes);
  if (keys.length === 0) return fail('"changes" is empty.');
  for (const key of keys) {
    if (!REQUEST_CHANGE_KEYS.has(key)) {
      return fail(
        key === 'auth'
          ? 'Auth cannot be read or changed by the assistant. Ask the user to configure it in the Auth tab.'
          : `Unsupported field "${key}". Allowed: ${[...REQUEST_CHANGE_KEYS].join(', ')}.`,
      );
    }
  }

  let next: RequestItem = { ...request };
  const summary: string[] = [];

  for (const field of ['name', 'description', 'url'] as const) {
    if (changes[field] === undefined) continue;
    const err = checkText(field, changes[field], field === 'url' ? 8000 : 1000);
    if (err) return fail(err);
    next = { ...next, [field]: changes[field] as string };
    summary.push(`${field[0].toUpperCase()}${field.slice(1)} → ${changes[field] as string}`);
  }
  if (changes.method !== undefined) {
    if (typeof changes.method !== 'string' || !/^[A-Za-z]{2,20}$/.test(changes.method)) {
      return fail('method must be an HTTP method name such as GET or POST.');
    }
    next = { ...next, method: changes.method.toUpperCase() };
    summary.push(`Method → ${next.method}`);
  }

  const patches: Array<['queryParams' | 'pathParams' | 'headers', string, boolean]> = [
    ['queryParams', 'query param', false],
    ['pathParams', 'path param', false],
    ['headers', 'header', true],
  ];
  for (const [field, label, ci] of patches) {
    if (changes[field] === undefined) continue;
    const existing = (next[field] ?? []) as KeyValueEntry[];
    const patched = applyPatch(label, existing, changes[field], ci);
    if (!patched.ok) return patched;
    next = { ...next, [field]: patched.value } as RequestItem;
    summary.push(...patched.summary);
  }

  if (changes.body !== undefined) {
    const b = changes.body;
    if (!isRecord(b)) return fail('body must be an object.');
    const modeErr = oneOf('body.mode', b.mode, BODY_MODES);
    if (modeErr) return fail(modeErr);
    const body: NonNullable<RequestItem['body']> = { mode: b.mode as NonNullable<RequestItem['body']>['mode'] };
    if (b.content !== undefined) {
      const err = checkText('body.content', b.content);
      if (err) return fail(err);
      body.content = b.content as string;
    }
    if (b.urlEncoded !== undefined) {
      const parsed = parseEntries('body field', b.urlEncoded);
      if (!parsed.ok) return parsed;
      body.urlEncoded = parsed.value.map(e => ({ ...e, enabled: e.enabled ?? true }));
    }
    next = { ...next, body };
    summary.push(`Body replaced (${body.mode}${body.content ? `, ${body.content.length} chars` : ''})`);
  }

  if (changes.graphql !== undefined) {
    if (request.protocol !== 'graphql') return fail('graphql changes only apply to GraphQL requests.');
    const g = changes.graphql;
    if (!isRecord(g)) return fail('graphql must be an object.');
    const graphql = { ...(next.graphql ?? { query: '' }) };
    for (const f of ['query', 'variables', 'operationName'] as const) {
      if (g[f] === undefined) continue;
      const err = checkText(`graphql.${f}`, g[f]);
      if (err) return fail(err);
      if (graphql[f] === g[f]) continue;
      graphql[f] = g[f] as string;
      summary.push(`GraphQL ${f} updated`);
    }
    next = { ...next, graphql };
  }

  if (changes.captures !== undefined) {
    const parsed = parseCaptures(changes.captures);
    if (!parsed.ok) return parsed;
    if (!sameJson(parsed.value, request.captures ?? [])) {
      next = { ...next, captures: parsed.value };
      summary.push(`Captures replaced (${parsed.value.length})`);
    }
  }
  if (changes.assertions !== undefined) {
    const parsed = parseAssertions(changes.assertions);
    if (!parsed.ok) return parsed;
    if (!sameJson(parsed.value, request.assertions ?? [])) {
      next = { ...next, assertions: parsed.value };
      summary.push(`Assertions replaced (${parsed.value.length})`);
    }
  }

  // A no-op edit would still ask the user to approve it; weaker models then loop on "fixing" it.
  if (sameJson(next, request)) {
    const sent = describeSentFields(changes);
    return fail(
      `No changes: ${sent.join(', ')} already ${sent.length === 1 ? 'has' : 'have'} the values you sent, so nothing was edited. ` +
        'Read the request again with get_request and send only fields whose values differ. To replace a GraphQL query, send the full new document as graphql.query (or use update_graphql_operation).',
    );
  }

  return { ok: true, value: next, summary };
}

/** Structural equality, ignoring object key order. */
function sameJson(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter(k => value[k] !== undefined)
      .sort()
      .map(k => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Field names the model sent, e.g. `graphql.operationName`, for error messages. */
function describeSentFields(changes: Record<string, unknown>): string[] {
  return Object.keys(changes).flatMap(key => {
    const value = changes[key];
    return key === 'graphql' && isRecord(value) ? Object.keys(value).map(f => `graphql.${f}`) : [key];
  });
}

/** Builds a new request from an assistant spec using the same validation as edits. */
export function buildRequestFromSpec(protocol: unknown, spec: unknown): AiResult<RequestItem> {
  if (protocol !== undefined && protocol !== 'http' && protocol !== 'graphql') {
    return fail('protocol must be "http" or "graphql".');
  }
  const base = protocol === 'graphql' ? createDefaultGraphQLRequest({ url: '' }) : createDefaultHttpRequest({ url: '' });
  const blank: RequestItem = { ...base, name: 'New Request', url: '' };
  const applied = applyRequestChanges(blank, spec);
  if (!applied.ok) return applied;
  return { ok: true, value: applied.value, summary: [`Create ${applied.value.protocol} request "${applied.value.name}"`, ...applied.summary] };
}

/** `scheme://host[:port]` of a URL as written; a leading `{{variable}}` (or `{{scheme}}://`) counts too. */
function originText(url: string): string {
  const match = url.trim().match(/^((?:[a-z][a-z0-9+.-]*|\{\{[^{}]*\}\}):\/\/)?([^/?#]*)/i);
  return `${match?.[1] ?? ''}${match?.[2] ?? ''}`;
}

/** Lowercased `scheme://host[:port]` of a URL; a leading `{{variable}}` counts as the host. */
export function urlOrigin(url: string): string {
  return originText(url).toLowerCase();
}

/** True when an edit points the request at a different scheme or host. */
export function changesUrlOrigin(before: string, after: string): boolean {
  return urlOrigin(before) !== urlOrigin(after);
}

/**
 * Values that start like a URL, including forms without `//` (`https:evil.test`) that WHATWG URL parsing
 * still sends to `evil.test`, and `host:port`.
 */
const URL_LIKE_VALUE = /^\s*[a-z][a-z0-9+.-]*:/i;
const VARIABLE_TOKEN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function variableNamesIn(text: string): string[] {
  return [...text.matchAll(VARIABLE_TOKEN)].map(m => m[1]);
}

function walkTree(
  items: CollectionTreeItem[],
  onRequest: (request: RequestItem) => void,
  onVariables: (variables: VariableEntry[]) => void,
): void {
  for (const item of items) {
    if (item.kind === 'request') {
      onRequest(item);
    } else {
      onVariables(item.variables ?? []);
      walkTree(item.items, onRequest, onVariables);
    }
  }
}

/** Every `scheme://host` written in the collection's request URLs (lowercased, `{{variables}}` kept). */
export function collectionUrlOrigins(collection: AwjcCollection): Set<string> {
  const origins = new Set<string>();
  walkTree(collection.items, r => origins.add(urlOrigin(r.url)), () => {});
  return origins;
}

/**
 * Names of variables that decide which host requests go to: variables in the scheme/host of any request URL,
 * variables holding a URL-like value in any scope, and (transitively) variables referenced by those values.
 * Changing one of these, or switching it on or off, can redirect requests.
 */
export function hostVariableNames(collection: AwjcCollection): Set<string> {
  const variables: VariableEntry[] = [
    ...(collection.variables ?? []),
    ...(collection.environments ?? []).flatMap(e => e.variables ?? []),
  ];
  const names = new Set<string>();
  walkTree(
    collection.items,
    r => variableNamesIn(originText(r.url)).forEach(n => names.add(n)),
    folderVariables => variables.push(...folderVariables),
  );
  for (const v of variables) if (URL_LIKE_VALUE.test(v.value ?? '')) names.add(v.key);
  for (let grew = true; grew; ) {
    grew = false;
    for (const v of variables) {
      if (!names.has(v.key)) continue;
      for (const n of variableNamesIn(v.value ?? '')) {
        if (!names.has(n)) {
          names.add(n);
          grew = true;
        }
      }
    }
  }
  return names;
}

/**
 * Keys of variables whose value or enabled state changes when they can redirect requests: a host variable
 * (see `hostVariableNames`), or a value that is or becomes URL-like.
 */
export function changedUrlVariables(
  before: VariableEntry[] | undefined,
  after: VariableEntry[],
  hostVariables: ReadonlySet<string> = new Set(),
): string[] {
  const previous = new Map((before ?? []).map(v => [v.key, v]));
  return after
    .filter(v => {
      const prior = previous.get(v.key);
      const old = prior?.value ?? '';
      const next = v.value ?? '';
      const changed = old !== next || (prior?.enabled !== false) !== (v.enabled !== false);
      return changed && (hostVariables.has(v.key) || URL_LIKE_VALUE.test(old) || URL_LIKE_VALUE.test(next));
    })
    .map(v => v.key);
}

/** Variables that newly gain or change a capture rule which writes into a host variable or one holding a URL. */
export function changedHostCaptures(
  before: CaptureRule[] | undefined,
  after: CaptureRule[] | undefined,
  hostVariables: ReadonlySet<string>,
): string[] {
  const previous = new Set((before ?? []).map(c => JSON.stringify(c)));
  const risky = (after ?? []).filter(
    c => c.enabled !== false && hostVariables.has(c.variable) && !previous.has(JSON.stringify(c)),
  );
  return [...new Set(risky.map(c => c.variable))];
}

/**
 * The `scheme://host[:port]` a request will actually be sent to, resolved with the same variables the
 * HTTP engine uses. Null when it cannot be resolved to an absolute URL. Userinfo is never included.
 */
export function resolveRequestOrigin(request: RequestItem, context: VariableInterpolationContext): string | null {
  try {
    const resolved = buildResolvedRequestUrl({
      rawUrl: request.url,
      queryParams: request.queryParams,
      pathParams: request.pathParams,
      context,
    });
    const parsed = new URL(resolved);
    return parsed.host ? `${parsed.protocol}//${parsed.host}`.toLowerCase() : null;
  } catch {
    return null;
  }
}

const VARIABLE_KEY = /^[^\s{}]+$/;

/** Upserts environment/collection variables. Secret or credential-like values can never be written. */
export function applyVariableChanges(
  existing: VariableEntry[] | undefined,
  incoming: unknown,
): AiResult<VariableEntry[]> {
  if (!Array.isArray(incoming) || incoming.length === 0) return fail('variables must be a non-empty array.');
  const result = [...(existing ?? [])];
  const summary: string[] = [];
  for (const item of incoming) {
    if (!isRecord(item) || typeof item.key !== 'string' || !VARIABLE_KEY.test(item.key.trim())) {
      return fail('Each variable needs a "key" without spaces or braces.');
    }
    const key = item.key.trim();
    const idx = result.findIndex(v => v.key === key);
    const current = idx >= 0 ? result[idx] : undefined;
    const currentHidden = current ? Boolean(current.secret) || isEntryHiddenFromAi(current) : false;
    const wantsSecret = item.secret === true || isSensitiveName(key) || currentHidden;

    let value: string | undefined;
    if (item.value !== undefined) {
      const err = checkText(`variable "${key}" value`, item.value, 20000);
      if (err) return fail(err);
      value = item.value as string;
      if (wantsSecret && !isSafeCredentialValue(value)) {
        return fail(
          `"${key}" is a secret, hidden, or credential variable. The assistant cannot set its value; ask the user to enter it in Environments.`,
        );
      }
    }
    const next: VariableEntry = {
      ...(current ?? { key, enabled: true }),
      key,
      enabled: item.enabled === undefined ? (current?.enabled ?? true) : item.enabled === true,
      ...(value !== undefined ? { value } : {}),
      ...(item.secret === true ? { secret: true } : {}),
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
    };
    if (idx >= 0) result[idx] = next;
    else result.push(next);
    summary.push(
      `${current ? 'Update' : 'Add'} variable ${key}${value !== undefined ? ` = ${value}` : next.secret ? ' (secret, value left for you)' : ''}`,
    );
  }
  return { ok: true, value: result, summary };
}

// ---------- Change previews ----------

/** One field that an assistant edit changes, for before/after previews. Hidden values stay masked. */
export interface AiFieldChange {
  field: string;
  before: string;
  after: string;
}

const PREVIEW_CHARS = 300;
const preview = (value: string | undefined): string => truncateText(value ?? '', PREVIEW_CHARS);

function entryMap(entries: Array<{ key: string; value?: string; enabled?: boolean }>): Map<string, string> {
  return new Map(entries.map(e => [e.key, `${e.value ?? ''}${e.enabled === false ? ' (disabled)' : ''}`]));
}

function diffEntries(
  label: string,
  before: Array<{ key: string; value?: string; enabled?: boolean }>,
  after: Array<{ key: string; value?: string; enabled?: boolean }>,
  out: AiFieldChange[],
): void {
  const a = entryMap(before);
  const b = entryMap(after);
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) !== b.get(key)) {
      out.push({ field: `${label} ${key}`, before: preview(a.get(key)), after: preview(b.get(key)) });
    }
  }
}

/** Field-by-field differences between two versions of a request, as the assistant is allowed to see them. */
export function describeRequestChanges(
  before: RequestItem,
  after: RequestItem,
  secrets: readonly string[] = [],
): AiFieldChange[] {
  const a = sanitizeRequestForAi(before, secrets);
  const b = sanitizeRequestForAi(after, secrets);
  const out: AiFieldChange[] = [];
  for (const field of ['name', 'description', 'method', 'url'] as const) {
    if ((a[field] ?? '') !== (b[field] ?? '')) {
      out.push({ field: field[0].toUpperCase() + field.slice(1), before: preview(a[field]), after: preview(b[field]) });
    }
  }
  diffEntries('Query param', a.queryParams, b.queryParams, out);
  diffEntries('Path param', a.pathParams, b.pathParams, out);
  diffEntries('Header', a.headers, b.headers, out);
  if (a.body.mode !== b.body.mode) out.push({ field: 'Body mode', before: a.body.mode, after: b.body.mode });
  if ((a.body.content ?? '') !== (b.body.content ?? '')) {
    out.push({ field: 'Body', before: preview(a.body.content), after: preview(b.body.content) });
  }
  diffEntries('Body field', a.body.urlEncoded ?? [], b.body.urlEncoded ?? [], out);
  for (const field of ['query', 'variables', 'operationName'] as const) {
    const x = a.graphql?.[field] ?? '';
    const y = b.graphql?.[field] ?? '';
    if (x !== y) out.push({ field: `GraphQL ${field}`, before: preview(x), after: preview(y) });
  }
  for (const field of ['captures', 'assertions'] as const) {
    const x = JSON.stringify(a[field]);
    const y = JSON.stringify(b[field]);
    if (x !== y) {
      out.push({ field: field[0].toUpperCase() + field.slice(1), before: preview(x), after: preview(y) });
    }
  }
  return out;
}

/** Variable differences for previews; hidden values are shown as hidden, never as text. */
export function describeVariableChanges(
  before: VariableEntry[] | undefined,
  after: VariableEntry[],
  secrets: readonly string[] = [],
): AiFieldChange[] {
  const view = (vars: VariableEntry[] | undefined) =>
    sanitizeVariablesForAi(vars, secrets).map(v => ({
      key: v.key,
      value: v.secret ? (v.value === undefined ? '(hidden)' : REDACTED) : v.value,
      enabled: v.enabled,
    }));
  const out: AiFieldChange[] = [];
  diffEntries('Variable', view(before), view(after), out);
  return out;
}

