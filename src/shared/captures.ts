import type { CaptureRule, VariableEntry } from './collectionSchema';
import type { CapturedVariableResult, HttpResponseResult, ParsedSetCookie } from './httpTypes';

export type CaptureResponseInput = Pick<
  HttpResponseResult,
  'status' | 'headers' | 'cookies' | 'body'
>;

interface JsonPathSegment {
  type: 'property' | 'index' | 'wildcard' | 'filter';
  key?: string;
  index?: number;
  filterExpr?: string;
}

/**
 * Parses a JSONPath expression (such as `$.data.user.id`, `$.items[0].name`,
 * `$.data.items[*].id`, `$.data.items[?(@.active==true)].id`, or `$.data.items.length`)
 * into structured path segments.
 */
export function parseJsonPathSegments(expression: string): JsonPathSegment[] {
  let expr = expression.trim();
  if (!expr) return [];

  if (expr === '$') return [];
  if (expr.startsWith('$.')) {
    expr = expr.slice(2);
  } else if (expr.startsWith('$')) {
    expr = expr.slice(1);
  }

  const segments: JsonPathSegment[] = [];
  let i = 0;

  while (i < expr.length) {
    if (expr[i] === '.') {
      i++;
      continue;
    }

    if (expr[i] === '[') {
      // Find matching closing bracket, respecting quotes
      let j = i + 1;
      let inQuote: string | null = null;
      let depth = 1;
      while (j < expr.length && depth > 0) {
        const ch = expr[j];
        if (inQuote) {
          if (ch === '\\') {
            j += 2;
            continue;
          }
          if (ch === inQuote) {
            inQuote = null;
          }
        } else {
          if (ch === '"' || ch === "'") {
            inQuote = ch;
          } else if (ch === '[') {
            depth++;
          } else if (ch === ']') {
            depth--;
            if (depth === 0) break;
          }
        }
        j++;
      }

      const inner = expr.slice(i + 1, j).trim();
      i = j + 1;

      if (inner === '*') {
        segments.push({ type: 'wildcard' });
      } else if (inner.startsWith('?(') && inner.endsWith(')')) {
        segments.push({
          type: 'filter',
          filterExpr: inner.slice(2, -1).trim(),
        });
      } else if (
        (inner.startsWith("'") && inner.endsWith("'")) ||
        (inner.startsWith('"') && inner.endsWith('"'))
      ) {
        segments.push({
          type: 'property',
          key: inner.slice(1, -1),
        });
      } else if (/^-?\d+$/.test(inner)) {
        segments.push({
          type: 'index',
          index: Number.parseInt(inner, 10),
        });
      } else {
        segments.push({
          type: 'property',
          key: inner,
        });
      }
    } else {
      let j = i;
      while (j < expr.length && expr[j] !== '.' && expr[j] !== '[') {
        j++;
      }
      const key = expr.slice(i, j).trim();
      if (key === '*') {
        segments.push({ type: 'wildcard' });
      } else if (key.length > 0) {
        segments.push({ type: 'property', key });
      }
      i = j;
    }
  }

  return segments;
}

function parseFilterLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (trimmed === 'undefined') return undefined;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function getNestedValue(item: unknown, dotPath: string): unknown {
  if (!dotPath) return item;
  const parts = dotPath.split('.').filter(Boolean);
  let cur: unknown = item;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function matchesFilterExpression(item: unknown, filterExpr: string): boolean {
  if (item === null || typeof item !== 'object') return false;

  const match = filterExpr.match(
    /^@(?:\.([a-zA-Z0-9_.$]+))?\s*(===|!==|==|!=|<=|>=|<|>)\s*(.+)$/,
  );
  if (match) {
    const [, fieldPath = '', op, rawRhs] = match;
    const actual = getNestedValue(item, fieldPath);
    const expected = parseFilterLiteral(rawRhs);

    switch (op) {
      case '==':
      case '===':
        return actual === expected;
      case '!=':
      case '!==':
        return actual !== expected;
      case '<':
        return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
      case '<=':
        return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
      case '>':
        return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
      case '>=':
        return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
      default:
        return false;
    }
  }

  // Truthiness check: e.g. `@.active`
  if (filterExpr.startsWith('@.')) {
    const actual = getNestedValue(item, filterExpr.slice(2).trim());
    return Boolean(actual);
  }

  return false;
}

/**
 * Evaluates a JSONPath expression against a parsed JSON value.
 */
export function evaluateJsonPath(data: unknown, expression: string): unknown {
  if (!expression || !expression.trim()) return undefined;
  const segments = parseJsonPathSegments(expression);
  if (segments.length === 0) return data;

  let current: unknown = data;
  let isMulti = false;

  for (let idx = 0; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (current === undefined || current === null) {
      return undefined;
    }

    // Notice: if `isMulti` is true, `current` is an array of matched nodes from a previous `[*]` or `[?(...)]`.
    // However, if the segment is `.length` right after a normal array property (where `isMulti` is false),
    // `.length` returns the array length!
    if (isMulti && Array.isArray(current)) {
      if (seg.type === 'property' && seg.key === 'length' && idx === segments.length - 1) {
        // Support `$.items[*].length` if items are arrays/strings, or fall back to matched list length
        const elementHasLength = current.some(
          el =>
            Array.isArray(el) ||
            (typeof el === 'object' && el !== null && 'length' in el),
        );
        if (!elementHasLength) {
          return current.length;
        }
      }

      const nextList: unknown[] = [];
      for (const el of current) {
        const res = applySingleSegment(el, seg);
        if (seg.type === 'wildcard' || seg.type === 'filter') {
          if (Array.isArray(res)) {
            nextList.push(...res);
          }
        } else if (res !== undefined) {
          nextList.push(res);
        }
      }
      current = nextList;
    } else {
      if (seg.type === 'wildcard' || seg.type === 'filter') {
        isMulti = true;
      }
      current = applySingleSegment(current, seg);
    }
  }

  return current;
}

function applySingleSegment(target: unknown, seg: JsonPathSegment): unknown {
  if (target === null || target === undefined) return undefined;

  switch (seg.type) {
    case 'property': {
      const key = seg.key ?? '';
      if (Array.isArray(target)) {
        if (key === 'length') return target.length;
        if (/^\d+$/.test(key)) return target[Number(key)];
        return undefined;
      }
      if (typeof target === 'string' && key === 'length') {
        return target.length;
      }
      if (typeof target === 'object') {
        const rec = target as Record<string, unknown>;
        return key in rec ? rec[key] : undefined;
      }
      return undefined;
    }

    case 'index': {
      if (!Array.isArray(target)) return undefined;
      const idx = seg.index ?? 0;
      const resolvedIdx = idx < 0 ? target.length + idx : idx;
      return target[resolvedIdx];
    }

    case 'wildcard': {
      if (Array.isArray(target)) {
        return [...target];
      }
      if (typeof target === 'object') {
        return Object.values(target as Record<string, unknown>);
      }
      return [];
    }

    case 'filter': {
      if (!Array.isArray(target)) return [];
      const expr = seg.filterExpr ?? '';
      return target.filter(item => matchesFilterExpression(item, expr));
    }
  }
}

function formatCapturedValue(val: unknown): string | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return JSON.stringify(val);
}

/**
 * Looks up a response header case-insensitively.
 */
export function findResponseHeaderValue(
  headers: Record<string, string> | undefined,
  headerName: string,
): string | undefined {
  if (!headers || !headerName) return undefined;
  const target = headerName.trim().toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) {
      return v;
    }
  }
  return undefined;
}

/**
 * Looks up a parsed response cookie by name.
 */
export function findResponseCookie(
  cookies: ParsedSetCookie[] | undefined,
  cookieName: string,
): ParsedSetCookie | undefined {
  if (!Array.isArray(cookies) || !cookieName) return undefined;
  const target = cookieName.trim();
  return cookies.find(c => c.name === target);
}

/**
 * Evaluates declarative post-response capture rules against an HTTP response.
 */
export function evaluateCaptures(
  rules: CaptureRule[] | undefined,
  response: CaptureResponseInput,
): CapturedVariableResult[] {
  if (!Array.isArray(rules) || rules.length === 0) return [];

  let parsedJson: unknown = undefined;
  let jsonParseAttempted = false;
  let jsonParseError: string | undefined;

  const getJson = (): { data: unknown; error?: string } => {
    if (!jsonParseAttempted) {
      jsonParseAttempted = true;
      try {
        parsedJson = JSON.parse(response.body);
      } catch (err) {
        jsonParseError = err instanceof Error ? err.message : 'Invalid JSON response body';
      }
    }
    return { data: parsedJson, error: jsonParseError };
  };

  const results: CapturedVariableResult[] = [];

  for (const rule of rules) {
    if (!rule || rule.enabled === false || !rule.variable.trim()) continue;

    const varName = rule.variable.trim();
    const expr = (rule.expression ?? '').trim();

    switch (rule.source) {
      case 'jsonpath': {
        const { data, error } = getJson();
        if (error) {
          results.push({
            variable: varName,
            scope: rule.scope,
            source: rule.source,
            expression: rule.expression,
            value: null,
            matched: false,
            secret: rule.secret,
            error: `Response body is not valid JSON: ${error}`,
          });
          break;
        }
        const extracted = evaluateJsonPath(data, expr || '$');
        const formatted = formatCapturedValue(extracted);
        results.push({
          variable: varName,
          scope: rule.scope,
          source: rule.source,
          expression: rule.expression,
          value: formatted,
          matched: formatted !== null,
          secret: rule.secret,
        });
        break;
      }

      case 'header': {
        const headerVal = findResponseHeaderValue(response.headers, expr);
        results.push({
          variable: varName,
          scope: rule.scope,
          source: rule.source,
          expression: rule.expression,
          value: headerVal ?? null,
          matched: headerVal !== undefined,
          secret: rule.secret,
        });
        break;
      }

      case 'cookie': {
        const cookie = findResponseCookie(response.cookies, expr);
        results.push({
          variable: varName,
          scope: rule.scope,
          source: rule.source,
          expression: rule.expression,
          value: cookie ? cookie.value : null,
          matched: Boolean(cookie),
          secret: rule.secret,
        });
        break;
      }

      case 'status': {
        results.push({
          variable: varName,
          scope: rule.scope,
          source: rule.source,
          expression: rule.expression,
          value: String(response.status),
          matched: true,
          secret: rule.secret,
        });
        break;
      }

      case 'body': {
        results.push({
          variable: varName,
          scope: rule.scope,
          source: rule.source,
          expression: rule.expression,
          value: response.body,
          matched: true,
          secret: rule.secret,
        });
        break;
      }
    }
  }

  return results;
}

/**
 * Applies matched capture results to variable arrays (`environment`, `collection`, `runtime`),
 * updating existing variable keys in place or appending new entries.
 */
export function applyCapturedVariablesToScopes(
  captures: CapturedVariableResult[],
  scopes: {
    environmentVariables?: VariableEntry[];
    collectionVariables?: VariableEntry[];
    runtimeVariables?: VariableEntry[];
  },
): {
  environmentVariables: VariableEntry[];
  collectionVariables: VariableEntry[];
  runtimeVariables: VariableEntry[];
} {
  const envVars = (scopes.environmentVariables ?? []).map(v => ({ ...v }));
  const colVars = (scopes.collectionVariables ?? []).map(v => ({ ...v }));
  const runVars = (scopes.runtimeVariables ?? []).map(v => ({ ...v }));

  const upsert = (list: VariableEntry[], result: CapturedVariableResult) => {
    if (!result.matched || result.value === null) return;
    const existingIdx = list.findIndex(v => v.key === result.variable);
    if (existingIdx !== -1) {
      list[existingIdx] = {
        ...list[existingIdx],
        value: result.value,
        enabled: true,
        ...(result.secret !== undefined ? { secret: result.secret } : {}),
      };
    } else {
      list.push({
        key: result.variable,
        value: result.value,
        enabled: true,
        ...(result.secret ? { secret: true } : {}),
      });
    }
  };

  for (const cap of captures) {
    if (!cap.matched || cap.value === null) continue;
    if (cap.scope === 'environment') {
      upsert(envVars, cap);
    } else if (cap.scope === 'collection') {
      upsert(colVars, cap);
    } else {
      upsert(runVars, cap);
    }
  }

  return {
    environmentVariables: envVars,
    collectionVariables: colVars,
    runtimeVariables: runVars,
  };
}
