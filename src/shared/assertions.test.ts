import { describe, it, expect } from 'vitest';
import { evaluateAssertions, type AssertionResponseInput } from './assertions';
import type { AssertionRule } from './collectionSchema';

describe('evaluateAssertions', () => {
  const sampleResponse: AssertionResponseInput = {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Request-Id': 'req-9988',
    },
    body: JSON.stringify({
      ok: true,
      count: 3,
      emptyText: '',
      items: [
        { id: 1, tag: 'alpha' },
        { id: 2, tag: 'beta' },
        { id: 3, tag: 'gamma' },
      ],
    }),
    timings: {
      dnsMs: 1,
      tcpMs: 2,
      tlsMs: 3,
      ttfbMs: 10,
      downloadMs: 4,
      totalMs: 20,
    },
  };

  it('evaluates status, responseTime, header, jsonpath, and body assertions across operators', () => {
    const rules: AssertionRule[] = [
      { target: 'status', operator: 'equals', expected: 200 },
      { target: 'status', operator: 'in', expected: [200, 201, 204] },
      { target: 'responseTime', operator: 'lessThan', expected: 500 },
      { target: 'responseTime', operator: 'greaterThan', expected: 5 },
      {
        target: 'header',
        headerName: 'content-type',
        operator: 'contains',
        expected: 'application/json',
      },
      {
        target: 'header',
        headerName: 'x-request-id',
        operator: 'matchesRegex',
        expected: '^req-\\d+$',
      },
      { target: 'jsonpath', path: '$.ok', operator: 'equals', expected: 'true' },
      { target: 'jsonpath', path: '$.count', operator: 'notEquals', expected: 0 },
      { target: 'jsonpath', path: '$.items', operator: 'isArray' },
      { target: 'jsonpath', path: '$.items', operator: 'isNotEmpty' },
      { target: 'jsonpath', path: '$.emptyText', operator: 'isEmpty' },
      { target: 'jsonpath', path: '$.items.length', operator: 'greaterThan', expected: 2 },
      { target: 'jsonpath', path: '$.missingField', operator: 'isUndefined' },
      { target: 'jsonpath', path: '$.ok', operator: 'isDefined' },
      { target: 'body', operator: 'notContains', expected: 'fatal_error' },
      {
        target: 'status',
        operator: 'equals',
        expected: 404,
        enabled: false,
      },
    ];

    const results = evaluateAssertions(rules, sampleResponse);
    expect(results).toHaveLength(15);
    for (const res of results) {
      expect(res.passed).toBe(true);
    }
  });

  it('reports failed assertions and invalid JSON errors accurately', () => {
    const rules: AssertionRule[] = [
      { target: 'status', operator: 'equals', expected: 201 },
      { target: 'jsonpath', path: '$.count', operator: 'greaterThan', expected: 10 },
    ];

    const results = evaluateAssertions(rules, sampleResponse);
    expect(results).toHaveLength(2);
    expect(results[0].passed).toBe(false);
    expect(results[0].message).toContain('FAIL: Expected status equals 201, but got 200');
    expect(results[1].passed).toBe(false);

    const nonJsonResponse: AssertionResponseInput = {
      ...sampleResponse,
      body: 'Plain text error',
    };
    const jsonFail = evaluateAssertions(
      [{ target: 'jsonpath', path: '$.id', operator: 'isDefined' }],
      nonJsonResponse,
    );
    expect(jsonFail[0].passed).toBe(false);
    expect(jsonFail[0].message).toContain('not valid JSON');
  });
});
