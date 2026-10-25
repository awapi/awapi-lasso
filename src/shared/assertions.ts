import type { AssertionOperator, AssertionRule } from './collectionSchema';
import type { AssertionEvaluationResult, HttpResponseResult } from './httpTypes';
import { evaluateJsonPath, findResponseHeaderValue } from './captures';

export type AssertionResponseInput = Pick<
  HttpResponseResult,
  'status' | 'headers' | 'body' | 'timings'
>;

function valuesAreLooselyEqual(actual: unknown, expected: unknown): boolean {
  if (actual === expected) return true;
  if (actual === undefined || actual === null || expected === undefined || expected === null) {
    return String(actual) === String(expected);
  }
  if (typeof actual === 'number' && typeof expected === 'string' && expected.trim() !== '') {
    const num = Number(expected);
    if (!Number.isNaN(num)) return actual === num;
  }
  if (typeof actual === 'string' && typeof expected === 'number') {
    const num = Number(actual);
    if (actual.trim() !== '' && !Number.isNaN(num)) return num === expected;
  }
  if (typeof actual === 'boolean' && typeof expected === 'string') {
    return String(actual) === expected.trim().toLowerCase();
  }
  if (typeof actual === 'string' && typeof expected === 'boolean') {
    return actual.trim().toLowerCase() === String(expected);
  }
  if (typeof actual === 'object' && typeof expected === 'object') {
    return JSON.stringify(actual) === JSON.stringify(expected);
  }
  return String(actual) === String(expected);
}

function toNumeric(val: unknown): number | null {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Number(val);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function parseExpectedList(
  expected: AssertionRule['expected'],
): Array<string | number | boolean> {
  if (Array.isArray(expected)) return expected;
  if (typeof expected === 'string') {
    const trimmed = expected.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // fallback to comma split
      }
    }
    return trimmed
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
  }
  if (expected !== undefined) return [expected];
  return [];
}

function checkIsEmpty(val: unknown): boolean {
  if (val === undefined || val === null || val === '') return true;
  if (Array.isArray(val)) return val.length === 0;
  if (typeof val === 'object') return Object.keys(val as Record<string, unknown>).length === 0;
  return false;
}

function evaluateOperator(
  operator: AssertionOperator,
  actual: unknown,
  expected: AssertionRule['expected'],
): boolean {
  switch (operator) {
    case 'equals':
      return valuesAreLooselyEqual(actual, expected);

    case 'notEquals':
      return !valuesAreLooselyEqual(actual, expected);

    case 'contains': {
      if (actual === undefined || actual === null) return false;
      const needle = String(expected ?? '');
      if (Array.isArray(actual)) {
        return actual.some(item => valuesAreLooselyEqual(item, expected));
      }
      if (typeof actual === 'string') {
        return actual.includes(needle);
      }
      return JSON.stringify(actual).includes(needle);
    }

    case 'notContains': {
      return !evaluateOperator('contains', actual, expected);
    }

    case 'matchesRegex': {
      if (actual === undefined || actual === null) return false;
      try {
        const regex = new RegExp(String(expected ?? ''));
        return regex.test(String(actual));
      } catch {
        return false;
      }
    }

    case 'lessThan': {
      const a = toNumeric(actual);
      const b = toNumeric(expected);
      return a !== null && b !== null && a < b;
    }

    case 'greaterThan': {
      const a = toNumeric(actual);
      const b = toNumeric(expected);
      return a !== null && b !== null && a > b;
    }

    case 'in': {
      const list = parseExpectedList(expected);
      return list.some(candidate => valuesAreLooselyEqual(actual, candidate));
    }

    case 'isDefined':
      return actual !== undefined && actual !== null;

    case 'isUndefined':
      return actual === undefined;

    case 'isEmpty':
      return checkIsEmpty(actual);

    case 'isNotEmpty':
      return !checkIsEmpty(actual);

    case 'isArray':
      return Array.isArray(actual);
  }
}

function formatTargetDescription(rule: AssertionRule): string {
  switch (rule.target) {
    case 'status':
      return 'status';
    case 'responseTime':
      return 'responseTime';
    case 'header':
      return `header[${rule.headerName || rule.path || ''}]`;
    case 'jsonpath':
      return `jsonpath(${rule.path || '$'})`;
    case 'body':
      return 'body';
  }
}

function formatValuePreview(val: unknown): string {
  if (val === undefined) return 'undefined';
  if (typeof val === 'string') {
    return val.length > 80 ? `"${val.slice(0, 77)}..."` : `"${val}"`;
  }
  return JSON.stringify(val);
}

/**
 * Evaluates a list of declarative post-response assertions against an HTTP response.
 */
export function evaluateAssertions(
  rules: AssertionRule[] | undefined,
  response: AssertionResponseInput,
): AssertionEvaluationResult[] {
  if (!Array.isArray(rules) || rules.length === 0) return [];

  let parsedJson: unknown = undefined;
  let jsonParsed = false;
  let jsonError: string | undefined;

  const getJson = (): { data: unknown; error?: string } => {
    if (!jsonParsed) {
      jsonParsed = true;
      try {
        parsedJson = JSON.parse(response.body);
      } catch (err) {
        jsonError = err instanceof Error ? err.message : 'Invalid JSON';
      }
    }
    return { data: parsedJson, error: jsonError };
  };

  const results: AssertionEvaluationResult[] = [];

  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;

    const targetLabel = formatTargetDescription(rule);
    let actual: unknown;

    if (rule.target === 'status') {
      actual = response.status;
    } else if (rule.target === 'responseTime') {
      actual = response.timings?.totalMs ?? 0;
    } else if (rule.target === 'header') {
      const headerKey = rule.headerName || rule.path || '';
      actual = findResponseHeaderValue(response.headers, headerKey);
    } else if (rule.target === 'body') {
      actual = response.body;
    } else if (rule.target === 'jsonpath') {
      const { data, error } = getJson();
      if (error) {
        results.push({
          rule,
          passed: false,
          actual: undefined,
          message: `${targetLabel} failed: response body is not valid JSON (${error})`,
        });
        continue;
      }
      actual = evaluateJsonPath(data, rule.path || '$');
    }

    const passed = evaluateOperator(rule.operator, actual, rule.expected);
    const expectedPart =
      rule.expected !== undefined ? ` ${formatValuePreview(rule.expected)}` : '';
    const message = passed
      ? `PASS: ${targetLabel} ${rule.operator}${expectedPart} (actual: ${formatValuePreview(actual)})`
      : `FAIL: Expected ${targetLabel} ${rule.operator}${expectedPart}, but got ${formatValuePreview(actual)}`;

    results.push({
      rule,
      passed,
      actual,
      message,
    });
  }

  return results;
}
