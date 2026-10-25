import type { VariableEntry } from './collectionSchema';

export const MAX_INTERPOLATION_DEPTH = 10;

export type VariableScopeSource =
  | 'global'
  | 'collection'
  | 'environment'
  | 'folder'
  | 'captured'
  | 'dynamic'
  | 'unresolved';

export interface ResolvedVariableInfo {
  key: string;
  value: string;
  source: VariableScopeSource;
  isSecret: boolean;
  isResolved: boolean;
  description?: string;
}

export interface VariableInterpolationContext {
  /** Lowest precedence: app-wide global variables. */
  globalVariables?: VariableEntry[];
  /** Collection-level default variables. */
  collectionVariables?: VariableEntry[];
  /** Active environment variables (already hydrated with secret values or looked up via `secretValues`). */
  environmentVariables?: VariableEntry[];
  /** Ancestor folders ordered from outermost folder to innermost folder. */
  folderVariablesChain?: VariableEntry[][];
  /** Runtime variables captured from prior responses. */
  capturedVariables?: VariableEntry[];
  /** Optional map of hydrated secret values keyed by variable name (or `scope:key`). */
  secretValues?: Record<string, string>;
  /** Optional deterministic overrides for dynamic variables during unit tests. */
  dynamicOverrides?: Partial<Record<string, () => string>>;
}

export interface InspectedVariableToken {
  /** Full token text including braces, e.g. `{{baseUrl}}` */
  rawToken: string;
  /** Variable name inside braces, e.g. `baseUrl` or `$uuid` */
  name: string;
  /** 0-based start index in the input string */
  start: number;
  /** 0-based end index (exclusive) in the input string */
  end: number;
  /** Fully resolved value (or raw token if unresolved) */
  resolvedValue: string;
  /** Where the variable came from */
  source: VariableScopeSource;
  /** True when the variable or any nested dependency is marked `secret: true` */
  isSecret: boolean;
  /** True when the variable was found and resolved */
  isResolved: boolean;
  /** Optional variable description */
  description?: string;
}

const VARIABLE_TOKEN_REGEX = /\{\{\s*([^{}\s]+)\s*\}\}/g;

function generateUuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function randomAlphaNumeric(length = 12): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

const BUILTIN_DYNAMIC_GENERATORS: Record<string, { generate: () => string; description: string }> = {
  $uuid: {
    generate: () => generateUuidV4(),
    description: 'Random UUID v4 per request execution',
  },
  $timestamp: {
    generate: () => String(Math.floor(Date.now() / 1000)),
    description: 'Current Unix epoch timestamp in seconds',
  },
  $timestampMs: {
    generate: () => String(Date.now()),
    description: 'Current Unix epoch timestamp in milliseconds',
  },
  $isoTimestamp: {
    generate: () => new Date().toISOString(),
    description: 'Current UTC ISO-8601 timestamp',
  },
  $randomInt: {
    generate: () => String(Math.floor(Math.random() * 10000)),
    description: 'Random integer between 0 and 9999',
  },
  $randomEmail: {
    generate: () => `user_${randomAlphaNumeric(8)}@example.test`,
    description: 'Random test email address',
  },
  $randomString: {
    generate: () => randomAlphaNumeric(16),
    description: 'Random 16-character alphanumeric string',
  },
};

export function isDynamicVariableName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILTIN_DYNAMIC_GENERATORS, name);
}

/**
 * Builds the flat lookup table of static/scoped variables in precedence order:
 * 1. Global -> 2. Collection -> 3. Active Environment -> 4. Ancestor Folders (outer->inner) -> 5. Captured
 */
export function buildScopedVariableMap(
  context: VariableInterpolationContext,
): Map<string, ResolvedVariableInfo> {
  const map = new Map<string, ResolvedVariableInfo>();
  const secrets = context.secretValues ?? {};

  const applyList = (list: VariableEntry[] | undefined, source: VariableScopeSource) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!entry || entry.enabled === false || !entry.key) continue;
      const secretLookup =
        secrets[`${source}:${entry.key}`] ?? secrets[entry.key] ?? entry.value ?? '';
      const rawValue = entry.secret ? secretLookup : (entry.value ?? '');
      map.set(entry.key, {
        key: entry.key,
        value: rawValue,
        source,
        isSecret: Boolean(entry.secret),
        isResolved: true,
        description: entry.description,
      });
    }
  };

  applyList(context.globalVariables, 'global');
  applyList(context.collectionVariables, 'collection');
  applyList(context.environmentVariables, 'environment');

  if (Array.isArray(context.folderVariablesChain)) {
    for (const folderVars of context.folderVariablesChain) {
      applyList(folderVars, 'folder');
    }
  }

  applyList(context.capturedVariables, 'captured');

  return map;
}

function resolveVariableEntryRecursive(
  name: string,
  map: Map<string, ResolvedVariableInfo>,
  context: VariableInterpolationContext,
  visited: Set<string>,
  depth: number,
): ResolvedVariableInfo {
  if (isDynamicVariableName(name)) {
    const override = context.dynamicOverrides?.[name];
    const builtin = BUILTIN_DYNAMIC_GENERATORS[name];
    return {
      key: name,
      value: override ? override() : builtin.generate(),
      source: 'dynamic',
      isSecret: false,
      isResolved: true,
      description: builtin.description,
    };
  }

  const found = map.get(name);
  if (!found) {
    return {
      key: name,
      value: `{{${name}}}`,
      source: 'unresolved',
      isSecret: false,
      isResolved: false,
    };
  }

  if (depth >= MAX_INTERPOLATION_DEPTH || visited.has(name)) {
    return found;
  }

  if (!found.value.includes('{{')) {
    return found;
  }

  const nextVisited = new Set(visited);
  nextVisited.add(name);

  let anySecretDependency = found.isSecret;
  let allNestedResolved = true;

  const expanded = found.value.replace(VARIABLE_TOKEN_REGEX, (fullMatch, innerName: string) => {
    if (nextVisited.has(innerName) || depth + 1 > MAX_INTERPOLATION_DEPTH) {
      return fullMatch;
    }
    const inner = resolveVariableEntryRecursive(
      innerName,
      map,
      context,
      nextVisited,
      depth + 1,
    );
    if (inner.isSecret) {
      anySecretDependency = true;
    }
    if (!inner.isResolved) {
      allNestedResolved = false;
      return fullMatch;
    }
    return inner.value;
  });

  return {
    ...found,
    value: expanded,
    isSecret: anySecretDependency,
    isResolved: allNestedResolved,
  };
}

/**
 * Resolves a single variable name (`baseUrl`, `$uuid`, etc.) against `context`.
 */
export function resolveVariable(
  name: string,
  context: VariableInterpolationContext = {},
): ResolvedVariableInfo {
  const map = buildScopedVariableMap(context);
  return resolveVariableEntryRecursive(name.trim(), map, context, new Set(), 0);
}

/**
 * Interpolates all `{{variable}}` placeholders inside `text` according to AwapiLasso's
 * 6-level precedence and recursive expansion rules. Unresolved variables remain as `{{name}}`.
 */
export function interpolateText(
  text: string,
  context: VariableInterpolationContext = {},
): string {
  if (!text || !text.includes('{{')) return text;
  const map = buildScopedVariableMap(context);

  return text.replace(VARIABLE_TOKEN_REGEX, (fullMatch, varName: string) => {
    const resolved = resolveVariableEntryRecursive(varName, map, context, new Set(), 0);
    return resolved.isResolved ? resolved.value : fullMatch;
  });
}

/**
 * Inspects all `{{variable}}` occurrences in `text` and returns their character ranges,
 * resolved values, scopes (`environment`, `collection`, `folder`, `captured`, `dynamic`, `unresolved`),
 * and secret flags for live URL bar highlighting and hover tooltips.
 */
export function inspectVariablesInText(
  text: string,
  context: VariableInterpolationContext = {},
): InspectedVariableToken[] {
  if (!text || !text.includes('{{')) return [];
  const map = buildScopedVariableMap(context);
  const tokens: InspectedVariableToken[] = [];

  const regex = new RegExp(VARIABLE_TOKEN_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const rawToken = match[0];
    const name = match[1];
    const start = match.index;
    const end = start + rawToken.length;
    const info = resolveVariableEntryRecursive(name, map, context, new Set(), 0);

    tokens.push({
      rawToken,
      name,
      start,
      end,
      resolvedValue: info.value,
      source: info.source,
      isSecret: info.isSecret,
      isResolved: info.isResolved,
      description: info.description,
    });
  }

  return tokens;
}
