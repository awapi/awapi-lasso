import type { AssertionRule, AwjcCollection, CaptureRule, CaptureScope } from './collectionSchema';
import { isHiddenValue } from './aiSanitize';
import { isDynamicVariableName } from './interpolation';

/** Shared helpers for converting other API clients' collections (Postman, Bruno) into `.awjc`. */

export type AnyRecord = Record<string, unknown>;

export interface CollectionImportResult {
  collection: AwjcCollection;
  /** Human-readable notes about source features that could not be converted exactly. */
  warnings: string[];
}

export const ENVIRONMENT_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6'];

/** Dynamic variables (shared by Postman and Bruno) that map onto a differently named AwapiLasso built-in. */
const DYNAMIC_VARIABLE_ALIASES: Record<string, string> = {
  $guid: '$uuid',
  $randomUUID: '$uuid',
};

const MAX_LISTED_NAMES = 5;

export function isObject(val: unknown): val is AnyRecord {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

export function asString(val: unknown): string | undefined {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return undefined;
}

/**
 * Groups warnings by kind so a large collection yields one line per problem instead of one per request.
 */
export class WarningCollector {
  private readonly grouped = new Map<string, string[]>();
  private readonly single: string[] = [];

  add(message: string): void {
    if (!this.single.includes(message)) this.single.push(message);
  }

  addFor(kind: string, itemName: string): void {
    const names = this.grouped.get(kind) ?? [];
    if (names.includes(itemName)) return;
    names.push(itemName);
    this.grouped.set(kind, names);
  }

  list(): string[] {
    const groupedLines = Array.from(this.grouped.entries()).map(([kind, names]) => {
      const shown = names.slice(0, MAX_LISTED_NAMES).join(', ');
      const more = names.length > MAX_LISTED_NAMES ? `, +${names.length - MAX_LISTED_NAMES} more` : '';
      return `${kind} (${names.length}: ${shown}${more})`;
    });
    return [...this.single, ...groupedLines];
  }
}

/** Marks literal credentials as `secret` so saving moves them into the OS keychain instead of the `.awjc` file. */
export function looksSecret(name: string, value: string | undefined, flagged = false): boolean {
  // Names like `authBaseUrl` look sensitive, but a plain URL (no `user:pass@`) is not a credential.
  if (!flagged && value && /^[a-z][a-z0-9+.-]*:\/\/[^@\s]*$/i.test(value)) return false;
  return isHiddenValue(name, value, flagged);
}

/**
 * Rewrites dynamic variables to their AwapiLasso names everywhere in `value` and records the
 * ones without an equivalent in `unsupported`.
 */
export function mapDynamicVariables<T>(value: T, unsupported: Set<string>): T {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*(\$[A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => {
      const alias = DYNAMIC_VARIABLE_ALIASES[name];
      if (alias) return `{{${alias}}}`;
      if (!isDynamicVariableName(name)) unsupported.add(name);
      return match;
    }) as T;
  }
  if (Array.isArray(value)) {
    return value.map(v => mapDynamicVariables(v, unsupported)) as T;
  }
  if (isObject(value)) {
    const out: AnyRecord = {};
    for (const [k, v] of Object.entries(value)) out[k] = mapDynamicVariables(v, unsupported);
    return out as T;
  }
  return value;
}

/** Matches a JS property chain such as `.data["user-id"][0]`. */
export const PROPERTY_PATH = String.raw`((?:\.[A-Za-z_$][\w$]*|\[\d+\]|\[(?:'[^']*'|"[^"]*")\])*)`;

/** Turns a JS property chain like `.data["user-id"][0]` into JSONPath `$.data['user-id'][0]`. */
export function toJsonPath(chain: string): string {
  return `$${chain.replace(/\["([^"]*)"\]/g, "['$1']")}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How a client's test-script API spells the idioms `convertTestScript` understands. */
export interface ScriptDialect {
  /** Global regexes whose first capture group is an asserted status code. */
  statusPatterns: RegExp[];
  /** Non-capturing regex sources that evaluate to the parsed JSON response body. */
  bodySources: string[];
  /** Regex sources for a response-header read, each with exactly one capture group: the header name. */
  headerReads: string[];
  /** Regex source for a variable setter call up to `(`, with exactly one capture group: the setter name. */
  setter: string;
  /** Capture scope for each setter name. */
  setterScopes: Record<string, CaptureScope>;
  /** Global regex matching the opening line of a test block (e.g. `pm.test("x", function () {`). */
  testWrapper: RegExp;
}

export interface ConvertedScript {
  assertions: AssertionRule[];
  captures: CaptureRule[];
  /** True when nothing but the understood idioms (plus test wrappers and comments) was in the script. */
  fullyConverted: boolean;
}

/**
 * Converts the most common test-script idioms (status checks and "save a response value into a
 * variable") into declarative assertions and captures.
 */
export function convertTestScript(script: string, dialect: ScriptDialect): ConvertedScript {
  const assertions: AssertionRule[] = [];
  const captures: CaptureRule[] = [];
  if (!script) return { assertions, captures, fullyConverted: true };
  const consumed: RegExp[] = [];

  const seenStatus = new Set<number>();
  for (const pattern of dialect.statusPatterns) {
    consumed.push(pattern);
    for (const m of script.matchAll(pattern)) {
      const code = Number(m[1]);
      if (seenStatus.has(code)) continue;
      seenStatus.add(code);
      assertions.push({ target: 'status', operator: 'equals', expected: code, enabled: true });
    }
  }

  // Aliases such as `const json = pm.response.json();`
  const bodySources = [...dialect.bodySources];
  const aliasDecl = new RegExp(
    String.raw`(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:${dialect.bodySources.join('|')})\s*;?`,
    'g',
  );
  for (const m of script.matchAll(aliasDecl)) {
    bodySources.push(`${escapeRegExp(m[1])}\\b`);
  }
  consumed.push(aliasDecl);

  // Groups: 1 = setter name, 2 = quote, 3 = variable name.
  const setCall = String.raw`${dialect.setter}\(\s*(['"])([^'"]+)\2\s*,\s*`;
  const jsonSet = new RegExp(`${setCall}(?:${bodySources.join('|')})${PROPERTY_PATH}\\s*\\)`, 'g');
  for (const m of script.matchAll(jsonSet)) {
    captures.push({
      variable: m[3],
      scope: dialect.setterScopes[m[1]] ?? 'runtime',
      source: 'jsonpath',
      expression: toJsonPath(m[4]),
      enabled: true,
    });
  }
  consumed.push(jsonSet);

  for (const headerRead of dialect.headerReads) {
    const headerSet = new RegExp(`${setCall}${headerRead}\\s*\\)`, 'g');
    for (const m of script.matchAll(headerSet)) {
      captures.push({
        variable: m[3],
        scope: dialect.setterScopes[m[1]] ?? 'runtime',
        source: 'header',
        expression: m[4],
        enabled: true,
      });
    }
    consumed.push(headerSet);
  }

  let rest = script;
  for (const pattern of consumed) rest = rest.replace(pattern, '');
  rest = rest
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(dialect.testWrapper, '')
    .replace(/\}\s*\)/g, '')
    .replace(/[;\s]/g, '');

  return { assertions, captures, fullyConverted: rest === '' };
}
