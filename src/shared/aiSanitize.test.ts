import { describe, expect, it } from 'vitest';
import {
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
  createEmptyCollection,
  type RequestItem,
} from './collectionSchema';
import type { HttpResponseResult } from './httpTypes';
import { REDACTED } from './aiContext';
import {
  MAX_TREE_NODES,
  applyRequestChanges,
  applyVariableChanges,
  buildRequestFromSpec,
  changedHostCaptures,
  changedUrlVariables,
  changesUrlOrigin,
  collectionUrlOrigins,
  hostVariableNames,
  resolveRequestOrigin,
  describeRequestChanges,
  describeVariableChanges,
  describeTreeForAi,
  isEntryHiddenFromAi,
  isHiddenValue,
  isSafeCredentialValue,
  sanitizeRequestForAi,
  sanitizeResponseForAi,
  sanitizeVariablesForAi,
  urlOrigin,
} from './aiSanitize';

const SECRET = 'sup3r-s3cret-value';

function request(overrides: Partial<RequestItem> = {}): RequestItem {
  return createDefaultHttpRequest({
    name: 'Users',
    method: 'POST',
    url: 'https://u:pw123@api.test/users?api_key=abcdef123&q=1',
    headers: [
      { key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true },
      { key: 'X-Trace', value: 'abc', enabled: true },
      { key: 'X-Custom', value: 'hidden-by-flag', enabled: true, secret: true },
    ],
    auth: { type: 'bearer', bearer: { token: SECRET } },
    body: { mode: 'json', content: `{"password":"hunter2hunter2","name":"bob","note":"${SECRET}"}` },
    ...overrides,
  });
}

function response(overrides: Partial<HttpResponseResult> = {}): HttpResponseResult {
  return {
    requestId: 'r',
    ok: true,
    finalUrl: 'https://api.test/users?token=zzzzzz',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    httpVersion: '1.1',
    headers: { 'content-type': 'application/json', 'set-cookie': 'sid=abc', 'x-api-key': 'k-123456' },
    rawHeaders: [],
    cookies: [{ name: 'sid', value: 'abc' }],
    body: `{"access_token":"tok_abcdef","echo":"${SECRET}","items":[1,2,3]}`,
    isBinary: false,
    contentType: 'application/json',
    sizeBytes: 100,
    transferSizeBytes: 100,
    timings: { dnsMs: 1, tcpMs: 1, tlsMs: 1, ttfbMs: 1, downloadMs: 1, totalMs: 5 },
    tls: null,
    redirects: [],
    captures: [
      { variable: 'userId', scope: 'runtime', source: 'jsonpath', value: '42', matched: true },
      { variable: 'authToken', scope: 'runtime', source: 'jsonpath', value: 'tok_abcdef', matched: true },
      { variable: 'flagged', scope: 'runtime', source: 'jsonpath', value: 'visible?', matched: true, secret: true },
    ],
    assertions: [
      { rule: { target: 'status', operator: 'equals', expected: 200 }, passed: true, actual: 200, message: `ok ${SECRET}` },
    ],
    sentHeaders: { Authorization: `Bearer ${SECRET}` },
    ...overrides,
  } as HttpResponseResult;
}

describe('credential helpers', () => {
  it('recognizes safe values and hidden values', () => {
    expect(isSafeCredentialValue('')).toBe(true);
    expect(isSafeCredentialValue('{{token}}')).toBe(true);
    expect(isSafeCredentialValue('Bearer {{token}}')).toBe(true);
    expect(isSafeCredentialValue('Bearer abc')).toBe(false);
    expect(isHiddenValue('Authorization', 'Bearer abc')).toBe(true);
    expect(isHiddenValue('Authorization', '{{t}}')).toBe(false);
    expect(isHiddenValue('X-Ok', 'v')).toBe(false);
    expect(isHiddenValue('X-Ok', 'v', true)).toBe(true);
    expect(isHiddenValue('X-Ok', undefined, true)).toBe(false);
  });
});

describe('sanitizeRequestForAi', () => {
  const out = sanitizeRequestForAi(request(), [SECRET]);
  const text = JSON.stringify(out);

  it('never contains secrets, credentials or auth details', () => {
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('hunter2hunter2');
    expect(text).not.toContain('pw123');
    expect(text).not.toContain('abcdef123');
    expect(text).not.toContain('hidden-by-flag');
    expect(out.authType).toBe('bearer');
    expect(text).not.toContain('"bearer":');
  });

  it('keeps useful, non-secret content', () => {
    expect(out.url).toContain('q=1');
    expect(out.headers.find(h => h.key === 'X-Trace')?.value).toBe('abc');
    expect(out.headers.find(h => h.key === 'Authorization')?.value).toBe(REDACTED);
    expect(out.body.content).toContain('"name":"bob"');
  });

  it('includes graphql fields and form data without file contents', () => {
    const gql = createDefaultGraphQLRequest();
    gql.graphql = { query: '{ me { id } }', variables: '{"token":"abc123456"}' };
    const g = sanitizeRequestForAi(gql);
    expect(g.graphql?.query).toBe('{ me { id } }');
    expect(g.graphql?.variables).not.toContain('abc123456');
    const form = sanitizeRequestForAi(
      request({ body: { mode: 'multipart-form', formData: [{ key: 'password', type: 'text', value: 'zzzzzz1', enabled: true }, { key: 'f', type: 'file', filePath: '/a.bin', enabled: true }] } }),
    );
    expect(JSON.stringify(form.body.formData)).not.toContain('zzzzzz1');
  });
});

describe('sanitizeResponseForAi', () => {
  it('redacts credentials, cookies, sent headers and secret captures', () => {
    const out = sanitizeResponseForAi(response(), [SECRET]);
    const text = JSON.stringify(out);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('tok_abcdef');
    expect(text).not.toContain('sid=abc');
    expect(text).not.toContain('k-123456');
    expect(text).not.toContain('zzzzzz');
    expect(text).not.toContain('visible?');
    expect(text).not.toContain('sentHeaders');
    expect(out.cookieNames).toEqual(['sid']);
    expect(out.captures[0].value).toBe('42');
    expect(out.captures[1].value).toBe(REDACTED);
    expect(out.status).toBe(200);
  });

  it('pages the body and reports the next offset', () => {
    const body = 'x'.repeat(100);
    const first = sanitizeResponseForAi(response({ body }), [], { maxChars: 40 });
    expect(first.body).toHaveLength(40);
    expect(first.nextOffset).toBe(40);
    expect(first.bodyLength).toBe(100);
    const last = sanitizeResponseForAi(response({ body }), [], { offset: 80, maxChars: 40 });
    expect(last.body).toHaveLength(20);
    expect(last.nextOffset).toBeNull();
  });

  it('omits binary bodies and surfaces transport errors', () => {
    const out = sanitizeResponseForAi(response({ isBinary: true, body: 'AAAA', error: `fail ${SECRET}`, status: 0 }), [SECRET]);
    expect(out.body).toBe('<binary body omitted>');
    expect(out.error).not.toContain(SECRET);
  });
});

describe('sanitizeVariablesForAi / describeTreeForAi', () => {
  it('hides secret and credential-looking values', () => {
    const out = sanitizeVariablesForAi(
      [
        { key: 'baseUrl', value: 'http://x', enabled: true },
        { key: 'apiToken', value: 'tok-123456', enabled: true },
        { key: 'flag', value: 'v', enabled: true, secret: true },
        { key: 'tokenRef', value: '{{other}}', enabled: true },
      ],
      [],
    );
    expect(out.find(v => v.key === 'baseUrl')?.value).toBe('http://x');
    expect(out.find(v => v.key === 'apiToken')).toMatchObject({ secret: true, value: undefined });
    expect(out.find(v => v.key === 'flag')).toMatchObject({ secret: true, value: undefined });
    expect(out.find(v => v.key === 'tokenRef')?.value).toBe('{{other}}');
    expect(JSON.stringify(out)).not.toContain('tok-123456');
  });

  it('outlines a tree without auth and caps size', () => {
    const tree = describeTreeForAi([
      { kind: 'folder', id: 'f', name: 'F', auth: { type: 'bearer', bearer: { token: SECRET } }, items: [request()] },
    ]);
    expect(JSON.stringify(tree)).not.toContain(SECRET);
    expect(tree.nodes[0].items?.[0].url).not.toContain('abcdef123');

    const many = Array.from({ length: MAX_TREE_NODES + 20 }, (_, i) => createDefaultHttpRequest({ id: `r${i}` }));
    const capped = describeTreeForAi(many);
    expect(capped.nodes).toHaveLength(MAX_TREE_NODES);
    expect(capped.truncated).toBe(true);
  });
});

describe('applyRequestChanges', () => {
  const base = request();

  it('refuses to touch auth or unknown fields', () => {
    const r = applyRequestChanges(base, { auth: { type: 'none' } });
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('Auth cannot be read or changed') });
    expect(applyRequestChanges(base, { bogus: 1 })).toMatchObject({ ok: false });
    expect(applyRequestChanges(base, {})).toMatchObject({ ok: false });
    expect(applyRequestChanges(base, 'x')).toMatchObject({ ok: false });
  });

  it('updates scalar fields and leaves auth untouched', () => {
    const r = applyRequestChanges(base, { name: 'N', url: '{{baseUrl}}/v2', method: 'put' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({ name: 'N', url: '{{baseUrl}}/v2', method: 'PUT' });
    expect(r.value.auth).toEqual(base.auth);
    expect(r.summary).toEqual(expect.arrayContaining(['Method → PUT']));
  });

  it('upserts headers by key without disturbing hidden ones, and removes case-insensitively', () => {
    const r = applyRequestChanges(base, {
      headers: { set: [{ key: 'x-trace', value: 'new' }, { key: 'Accept', value: 'application/json' }], remove: ['x-custom'] },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const headers = r.value.headers ?? [];
    expect(headers.find(h => h.key === 'Authorization')?.value).toBe(`Bearer ${SECRET}`);
    expect(headers.find(h => h.key === 'X-Trace')?.value).toBe('new');
    expect(headers.some(h => h.key === 'X-Custom')).toBe(false);
    expect(headers.find(h => h.key === 'Accept')).toMatchObject({ value: 'application/json', enabled: true });
  });

  it('keeps an existing entry enabled state unless provided', () => {
    const disabled = request({ headers: [{ key: 'X-A', value: '1', enabled: false }] });
    const r = applyRequestChanges(disabled, { headers: { set: [{ key: 'X-A', value: '2' }] } });
    expect(r.ok && r.value.headers?.[0]).toMatchObject({ value: '2', enabled: false });
    const r2 = applyRequestChanges(disabled, { headers: { set: [{ key: 'X-A', enabled: true }] } });
    expect(r2.ok && r2.value.headers?.[0]).toMatchObject({ value: '1', enabled: true });
  });

  it('rejects literal credentials, overwriting flagged secrets, and the redaction placeholder', () => {
    expect(applyRequestChanges(base, { headers: { set: [{ key: 'Authorization', value: 'Bearer abc123' }] } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('{{variable}}'),
    });
    expect(applyRequestChanges(base, { headers: { set: [{ key: 'Authorization', value: 'Bearer {{token}}' }] } }).ok).toBe(true);
    expect(applyRequestChanges(base, { headers: { set: [{ key: 'X-Custom', value: 'new-literal' }] } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('hidden value'),
    });
    expect(applyRequestChanges(base, { queryParams: { set: [{ key: 'api_key', value: 'abc12345' }] } }).ok).toBe(false);
    expect(applyRequestChanges(base, { body: { mode: 'json', content: `{"password":"${REDACTED}"}` } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('placeholder'),
    });
    expect(applyRequestChanges(base, { url: `https://x/${REDACTED}` }).ok).toBe(false);
  });

  it('replaces the body and validates modes', () => {
    const r = applyRequestChanges(base, { body: { mode: 'json', content: '{"a":1}' } });
    expect(r.ok && r.value.body).toEqual({ mode: 'json', content: '{"a":1}' });
    const form = applyRequestChanges(base, { body: { mode: 'form-urlencoded', urlEncoded: [{ key: 'a', value: '1' }] } });
    expect(form.ok && form.value.body?.urlEncoded).toEqual([{ key: 'a', value: '1', enabled: true }]);
    expect(applyRequestChanges(base, { body: { mode: 'weird' } }).ok).toBe(false);
    expect(applyRequestChanges(base, { method: 'GET /x' }).ok).toBe(false);
  });

  it('edits graphql only for graphql requests', () => {
    expect(applyRequestChanges(base, { graphql: { query: '{a}' } }).ok).toBe(false);
    const gql = createDefaultGraphQLRequest();
    const r = applyRequestChanges(gql, { graphql: { query: '{ me { id } }' } });
    expect(r.ok && r.value.graphql?.query).toBe('{ me { id } }');
    expect(r.ok && r.value.graphql?.variables).toBe(gql.graphql?.variables);
  });

  it('validates captures and assertions', () => {
    const r = applyRequestChanges(base, {
      captures: [{ variable: 'id', scope: 'runtime', source: 'jsonpath', expression: '$.id' }],
      assertions: [{ target: 'status', operator: 'equals', expected: 200 }],
    });
    expect(r.ok && r.value.captures).toEqual([{ variable: 'id', scope: 'runtime', source: 'jsonpath', expression: '$.id', enabled: true }]);
    expect(r.ok && r.value.assertions?.[0]).toMatchObject({ target: 'status', operator: 'equals', expected: 200 });
    expect(applyRequestChanges(base, { captures: [{ variable: 'x', scope: 'nope', source: 'body' }] }).ok).toBe(false);
    expect(applyRequestChanges(base, { assertions: [{ target: 'status', operator: 'nope' }] }).ok).toBe(false);
    expect(applyRequestChanges(base, { assertions: [{ target: 'status', operator: 'equals', expected: {} }] }).ok).toBe(false);
  });
});

describe('buildRequestFromSpec', () => {
  it('creates http and graphql requests through the same validation', () => {
    const http = buildRequestFromSpec(undefined, { name: 'List', method: 'GET', url: '{{baseUrl}}/items' });
    expect(http.ok && http.value).toMatchObject({ name: 'List', protocol: 'http', url: '{{baseUrl}}/items', auth: { type: 'inherit' } });
    const gql = buildRequestFromSpec('graphql', { name: 'Q', url: '{{baseUrl}}/graphql', graphql: { query: '{ a }' } });
    expect(gql.ok && gql.value.graphql?.query).toBe('{ a }');
    expect(buildRequestFromSpec('soap', { name: 'x' }).ok).toBe(false);
    expect(buildRequestFromSpec(undefined, { auth: {} }).ok).toBe(false);
  });
});

describe('applyVariableChanges', () => {
  it('adds and updates plain variables', () => {
    const r = applyVariableChanges([{ key: 'baseUrl', value: 'a', enabled: true }], [
      { key: 'baseUrl', value: 'b' },
      { key: 'region', value: 'eu', description: 'Region' },
    ]);
    expect(r.ok && r.value).toEqual([
      { key: 'baseUrl', value: 'b', enabled: true },
      { key: 'region', value: 'eu', enabled: true, description: 'Region' },
    ]);
  });

  it('never sets secret or credential-looking values', () => {
    expect(applyVariableChanges([], [{ key: 'apiToken', value: 'abc12345' }])).toMatchObject({ ok: false });
    expect(applyVariableChanges([], [{ key: 'foo', value: 'abc12345', secret: true }])).toMatchObject({ ok: false });
    expect(
      applyVariableChanges([{ key: 'foo', value: 'orig', enabled: true, secret: true }], [{ key: 'foo', value: 'new' }]),
    ).toMatchObject({ ok: false });
    expect(applyVariableChanges([], [{ key: 'x', value: REDACTED }])).toMatchObject({ ok: false });
  });

  it('can add a secret placeholder and template references', () => {
    const r = applyVariableChanges([], [
      { key: 'clientSecret', secret: true },
      { key: 'apiToken', value: '{{other}}' },
    ]);
    expect(r.ok && r.value).toEqual([
      { key: 'clientSecret', enabled: true, secret: true },
      { key: 'apiToken', enabled: true, value: '{{other}}' },
    ]);
    expect(r.ok && r.summary[0]).toContain('value left for you');
  });

  it('validates input shape', () => {
    expect(applyVariableChanges([], [])).toMatchObject({ ok: false });
    expect(applyVariableChanges([], [{ key: 'has space' }])).toMatchObject({ ok: false });
    expect(applyVariableChanges([], 'x')).toMatchObject({ ok: false });
  });
});

describe('literal secrets in writes', () => {
  it('rejects known key formats in bodies, urls, header values and variables', () => {
    const key = ['sk-', 'proj-', 'Ab3dEf6hIj9kLm2nOp5qRs8t'].join('');
    expect(applyRequestChanges(request(), { body: { mode: 'json', content: `{"key":"${key}"}` } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('literal OpenAI / Anthropic key'),
    });
    expect(applyRequestChanges(request(), { url: `https://x.test/?k=${key}` }).ok).toBe(false);
    expect(applyRequestChanges(request(), { headers: { set: [{ key: 'X-Note', value: key }] } }).ok).toBe(false);
    expect(applyVariableChanges([], [{ key: 'note', value: key }]).ok).toBe(false);
    expect(applyRequestChanges(request(), { body: { mode: 'json', content: '{"key":"{{openaiKey}}"}' } }).ok).toBe(true);
  });
});

describe('redirect detection', () => {
  it('extracts the scheme and host, treating a leading {{variable}} as the host', () => {
    expect(urlOrigin('https://API.example.com:8443/v1?x=1')).toBe('https://api.example.com:8443');
    expect(urlOrigin('{{baseUrl}}/users')).toBe('{{baseurl}}');
    expect(urlOrigin('example.com/path')).toBe('example.com');
  });

  it('flags host and scheme changes but not path or query changes', () => {
    expect(changesUrlOrigin('{{baseUrl}}/users', '{{baseUrl}}/users/1?x=2')).toBe(false);
    expect(changesUrlOrigin('{{baseUrl}}/users', 'https://evil.test/users')).toBe(true);
    expect(changesUrlOrigin('https://a.test/x', 'http://a.test/x')).toBe(true);
  });

  it('lists variables whose value changes to or from a URL', () => {
    const before = [
      { key: 'baseUrl', value: 'https://a.test', enabled: true },
      { key: 'region', value: 'eu', enabled: true },
    ];
    const after = [
      { key: 'baseUrl', value: 'https://evil.test', enabled: true },
      { key: 'region', value: 'us', enabled: true },
      { key: 'cdn', value: 'https://cdn.test', enabled: true },
    ];
    expect(changedUrlVariables(before, after)).toEqual(['baseUrl', 'cdn']);
    expect(changedUrlVariables(before, before)).toEqual([]);
  });

  it('treats a leading {{scheme}}:// as part of the origin', () => {
    expect(urlOrigin('{{scheme}}://{{host}}/v1')).toBe('{{scheme}}://{{host}}');
  });

  it('flags scheme forms without // and switching a URL variable off', () => {
    expect(changedUrlVariables([], [{ key: 'baseUrl', value: 'https:evil.test', enabled: true }])).toEqual(['baseUrl']);
    expect(changedUrlVariables([], [{ key: 'api', value: 'evil.test:443', enabled: true }])).toEqual(['api']);
    const on = [{ key: 'baseUrl', value: 'https://a.test', enabled: true }];
    expect(changedUrlVariables(on, [{ ...on[0], enabled: false }])).toEqual(['baseUrl']);
  });

  it('flags any change to a host variable, even when the value is a bare host', () => {
    const before = [{ key: 'host', value: 'api.good.test', enabled: true }];
    const after = [{ key: 'host', value: 'evil.test', enabled: true }];
    expect(changedUrlVariables(before, after)).toEqual([]);
    expect(changedUrlVariables(before, after, new Set(['host']))).toEqual(['host']);
    expect(changedUrlVariables(before, before, new Set(['host']))).toEqual([]);
  });

  it('finds the variables that decide request hosts, across scopes, folders and references', () => {
    const collection = {
      ...createEmptyCollection('C', {
        items: [
          createDefaultHttpRequest({ url: 'https://{{host}}/v1/{{version}}' }),
          {
            kind: 'folder' as const,
            id: 'f',
            name: 'F',
            variables: [{ key: 'svc', value: '{{scheme}}://{{svcHost}}', enabled: true }],
            items: [createDefaultHttpRequest({ url: '{{baseUrl}}/users?q={{query}}' })],
          },
        ],
      }),
      variables: [{ key: 'baseUrl', value: 'https://{{tenant}}.api.test', enabled: true }],
      environments: [{ id: 'e', name: 'dev', variables: [{ key: 'region', value: 'eu', enabled: true }] }],
    };
    const names = hostVariableNames(collection);
    expect([...names].sort()).toEqual(['baseUrl', 'host', 'tenant'].sort());
    expect(names.has('version')).toBe(false);
    expect(names.has('query')).toBe(false);
    expect(collectionUrlOrigins(collection)).toEqual(new Set(['https://{{host}}', '{{baseurl}}']));
  });

  it('flags new or changed captures into host variables only', () => {
    const hosts = new Set(['baseUrl']);
    const capture = { variable: 'baseUrl', scope: 'environment' as const, source: 'jsonpath' as const, expression: '$.url', enabled: true };
    const harmless = { ...capture, variable: 'orderId' };
    expect(changedHostCaptures([], [capture, harmless], hosts)).toEqual(['baseUrl']);
    expect(changedHostCaptures([capture], [capture], hosts)).toEqual([]);
    expect(changedHostCaptures([capture], [{ ...capture, expression: '$.website' }], hosts)).toEqual(['baseUrl']);
    expect(changedHostCaptures([], [{ ...capture, enabled: false }], hosts)).toEqual([]);
  });

  it('resolves the origin a request is sent to, without userinfo', () => {
    const request = createDefaultHttpRequest({ url: '{{baseUrl}}/users/:id', pathParams: [{ key: 'id', value: '1' }] });
    const env = (value: string) => ({ environmentVariables: [{ key: 'baseUrl', value, enabled: true }] });
    expect(resolveRequestOrigin(request, env('https://API.good.test:8443/v1'))).toBe('https://api.good.test:8443');
    expect(resolveRequestOrigin(request, env('https:evil.test'))).toBe('https://evil.test');
    expect(resolveRequestOrigin(request, env('https://user:pw@evil.test'))).toBe('https://evil.test');
    expect(
      resolveRequestOrigin(request, {
        ...env('https://good.test'),
        capturedVariables: [{ key: 'baseUrl', value: 'https://evil.test', enabled: true }],
      }),
    ).toBe('https://evil.test');
    expect(resolveRequestOrigin(request, {})).toBeNull();
  });
});

describe('hideFromAi flag', () => {
  it('treats flagged entries with neutral names as hidden', () => {
    expect(isEntryHiddenFromAi({ key: 'accountId', value: '12345', hideFromAi: true })).toBe(true);
    expect(isEntryHiddenFromAi({ key: 'accountId', value: '12345' })).toBe(false);
    expect(isEntryHiddenFromAi({ key: 'accountId', value: '', hideFromAi: true })).toBe(false);
  });

  it('masks flagged headers, params and variables', () => {
    const req = request({
      headers: [{ key: 'X-Tenant', value: 'acme-corp', enabled: true, hideFromAi: true }],
      queryParams: [{ key: 'account', value: '998877', enabled: true, hideFromAi: true }],
    });
    const view = JSON.stringify(sanitizeRequestForAi(req));
    expect(view).not.toContain('acme-corp');
    expect(view).not.toContain('998877');
    expect(sanitizeVariablesForAi([{ key: 'accountId', value: '12345', enabled: true, hideFromAi: true }])[0]).toMatchObject({
      secret: true,
      value: undefined,
    });
  });

  it('refuses to overwrite flagged values but keeps them on unrelated edits', () => {
    const req = request({ headers: [{ key: 'X-Tenant', value: 'acme-corp', enabled: true, hideFromAi: true }] });
    expect(applyRequestChanges(req, { headers: { set: [{ key: 'X-Tenant', value: 'other' }] } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('hidden value'),
    });
    const kept = applyRequestChanges(req, { headers: { set: [{ key: 'X-Tenant', enabled: false }] } });
    expect(kept.ok && kept.value.headers?.[0]).toMatchObject({ value: 'acme-corp', hideFromAi: true, enabled: false });

    const vars = [{ key: 'accountId', value: '12345', enabled: true, hideFromAi: true }];
    expect(applyVariableChanges(vars, [{ key: 'accountId', value: '999' }]).ok).toBe(false);
    const toggled = applyVariableChanges(vars, [{ key: 'accountId', enabled: false }]);
    expect(toggled.ok && toggled.value[0]).toMatchObject({ value: '12345', hideFromAi: true, enabled: false });
  });
});

describe('change previews', () => {
  it('lists changed request fields with before and after, keeping hidden values masked', () => {
    const before = request({ url: '{{baseUrl}}/users', body: { mode: 'json', content: '{"a":1}' } });
    const after = applyRequestChanges(before, {
      url: '{{baseUrl}}/v2/users',
      headers: { set: [{ key: 'X-Trace', value: 'def' }, { key: 'Accept', value: 'application/json' }], remove: ['X-Custom'] },
      body: { mode: 'json', content: '{"a":2}' },
    });
    expect(after.ok).toBe(true);
    const changes = describeRequestChanges(before, (after as { value: RequestItem }).value, [SECRET]);
    expect(changes).toEqual([
      { field: 'Url', before: '{{baseUrl}}/users', after: '{{baseUrl}}/v2/users' },
      { field: 'Header X-Trace', before: 'abc', after: 'def' },
      { field: 'Header X-Custom', before: REDACTED, after: '' },
      { field: 'Header Accept', before: '', after: 'application/json' },
      { field: 'Body', before: '{"a":1}', after: '{"a":2}' },
    ]);
    expect(JSON.stringify(changes)).not.toContain('hidden-by-flag');
    expect(describeRequestChanges(before, before)).toEqual([]);
  });

  it('describes variable changes without revealing hidden values', () => {
    const before = [
      { key: 'region', value: 'eu', enabled: true },
      { key: 'apiToken', value: 'tok-123456', enabled: true, secret: true },
    ];
    const after = [
      { key: 'region', value: 'us', enabled: true },
      { key: 'apiToken', value: 'tok-123456', enabled: false, secret: true },
      { key: 'newVar', value: 'x', enabled: true },
    ];
    const changes = describeVariableChanges(before, after);
    expect(changes).toEqual([
      { field: 'Variable region', before: 'eu', after: 'us' },
      { field: 'Variable apiToken', before: '(hidden)', after: '(hidden) (disabled)' },
      { field: 'Variable newVar', before: '', after: 'x' },
    ]);
    expect(JSON.stringify(changes)).not.toContain('tok-123456');
  });
});
