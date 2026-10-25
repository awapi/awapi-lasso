import { describe, it, expect } from 'vitest';
import {
  evaluateJsonPath,
  evaluateCaptures,
  applyCapturedVariablesToScopes,
  type CaptureResponseInput,
} from './captures';
import type { CaptureRule } from './collectionSchema';

describe('evaluateJsonPath', () => {
  const sampleData = {
    access_token: 'tok_abc_123',
    data: {
      id: 42,
      user: {
        name: 'Alice',
        roles: ['admin', 'editor'],
      },
      items: [
        { id: 'item-1', active: true, price: 25 },
        { id: 'item-2', active: false, price: 10 },
        { id: 'item-3', active: true, price: 50 },
      ],
    },
    'special.key': 'dotted-value',
  };

  it('resolves simple dot and nested paths', () => {
    expect(evaluateJsonPath(sampleData, '$.access_token')).toBe('tok_abc_123');
    expect(evaluateJsonPath(sampleData, '$.data.id')).toBe(42);
    expect(evaluateJsonPath(sampleData, '$.data.user.name')).toBe('Alice');
  });

  it('resolves array indices including negative indices and .length', () => {
    expect(evaluateJsonPath(sampleData, '$.data.user.roles[0]')).toBe('admin');
    expect(evaluateJsonPath(sampleData, '$.data.user.roles[-1]')).toBe('editor');
    expect(evaluateJsonPath(sampleData, '$.data.items.length')).toBe(3);
  });

  it('resolves wildcard slices and bracketed property names', () => {
    expect(evaluateJsonPath(sampleData, '$.data.items[*].id')).toEqual([
      'item-1',
      'item-2',
      'item-3',
    ]);
    expect(evaluateJsonPath(sampleData, "$['special.key']")).toBe('dotted-value');
  });

  it('evaluates filter expressions [?(@.field == value)]', () => {
    expect(evaluateJsonPath(sampleData, '$.data.items[?(@.active==true)].id')).toEqual([
      'item-1',
      'item-3',
    ]);
    expect(evaluateJsonPath(sampleData, '$.data.items[?(@.price>20)].id')).toEqual([
      'item-1',
      'item-3',
    ]);
  });

  it('returns undefined for missing paths', () => {
    expect(evaluateJsonPath(sampleData, '$.data.nonexistent.field')).toBeUndefined();
  });
});

describe('evaluateCaptures & applyCapturedVariablesToScopes', () => {
  const sampleResponse: CaptureResponseInput = {
    status: 201,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-CSRF-Token': 'csrf_secret_99',
    },
    cookies: [
      {
        name: 'SID',
        value: 'session_xyz',
        path: '/',
        httpOnly: true,
        secure: true,
        raw: 'SID=session_xyz; Path=/; HttpOnly; Secure',
      },
    ],
    body: JSON.stringify({
      access_token: 'jwt_token_value',
      data: {
        id: 'usr_777',
      },
    }),
  };

  it('extracts jsonpath, header, cookie, status, and body captures', () => {
    const rules: CaptureRule[] = [
      {
        variable: 'userId',
        scope: 'environment',
        source: 'jsonpath',
        expression: '$.data.id',
        enabled: true,
      },
      {
        variable: 'authToken',
        scope: 'collection',
        source: 'jsonpath',
        expression: '$.access_token',
        secret: true,
        enabled: true,
      },
      {
        variable: 'csrfToken',
        scope: 'environment',
        source: 'header',
        expression: 'x-csrf-token',
        enabled: true,
      },
      {
        variable: 'sessionCookie',
        scope: 'runtime',
        source: 'cookie',
        expression: 'SID',
        enabled: true,
      },
      {
        variable: 'lastStatus',
        scope: 'runtime',
        source: 'status',
        enabled: true,
      },
      {
        variable: 'disabledVar',
        scope: 'environment',
        source: 'header',
        expression: 'content-type',
        enabled: false,
      },
    ];

    const results = evaluateCaptures(rules, sampleResponse);
    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({
      variable: 'userId',
      scope: 'environment',
      value: 'usr_777',
      matched: true,
    });
    expect(results[1]).toMatchObject({
      variable: 'authToken',
      scope: 'collection',
      value: 'jwt_token_value',
      matched: true,
      secret: true,
    });
    expect(results[2]).toMatchObject({
      variable: 'csrfToken',
      value: 'csrf_secret_99',
      matched: true,
    });
    expect(results[3]).toMatchObject({
      variable: 'sessionCookie',
      value: 'session_xyz',
      matched: true,
    });
    expect(results[4]).toMatchObject({
      variable: 'lastStatus',
      value: '201',
      matched: true,
    });

    const updated = applyCapturedVariablesToScopes(results, {
      environmentVariables: [{ key: 'userId', value: 'old_id', enabled: true }],
      collectionVariables: [],
      runtimeVariables: [],
    });

    expect(updated.environmentVariables).toEqual([
      { key: 'userId', value: 'usr_777', enabled: true },
      { key: 'csrfToken', value: 'csrf_secret_99', enabled: true },
    ]);
    expect(updated.collectionVariables).toEqual([
      { key: 'authToken', value: 'jwt_token_value', enabled: true, secret: true },
    ]);
    expect(updated.runtimeVariables).toEqual([
      { key: 'sessionCookie', value: 'session_xyz', enabled: true },
      { key: 'lastStatus', value: '201', enabled: true },
    ]);
  });

  it('reports non-matching error gracefully when jsonpath is used on non-JSON body', () => {
    const htmlResponse: CaptureResponseInput = {
      status: 500,
      headers: {},
      cookies: [],
      body: '<html>Internal Error</html>',
    };
    const results = evaluateCaptures(
      [
        {
          variable: 'id',
          scope: 'environment',
          source: 'jsonpath',
          expression: '$.id',
        },
      ],
      htmlResponse,
    );
    expect(results).toHaveLength(1);
    expect(results[0].matched).toBe(false);
    expect(results[0].value).toBeNull();
    expect(results[0].error).toContain('not valid JSON');
  });
});
