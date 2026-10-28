import { describe, expect, it } from 'vitest';
import {
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
  createEmptyCollection,
  type EnvironmentConfig,
} from '../../shared/collectionSchema';
import type { HttpResponseResult } from '../../shared/httpTypes';
import { buildSystemPrompt } from '../../shared/aiContext';
import { buildAiChatContext, collectAuthSecretValues, collectWorkspaceSecretValues } from './aiContextBuilder';

const env: EnvironmentConfig = {
  id: 'e1',
  name: 'local',
  variables: [
    { key: 'baseUrl', value: 'http://localhost', enabled: true },
    { key: 'apiToken', value: 'tok-very-secret', enabled: true, secret: true },
    { key: 'disabled', value: 'x', enabled: false },
  ],
};

function response(overrides: Partial<HttpResponseResult> = {}): HttpResponseResult {
  return {
    requestId: 'r',
    ok: false,
    finalUrl: 'http://localhost/x',
    method: 'GET',
    status: 500,
    statusText: 'Server Error',
    httpVersion: '1.1',
    headers: { 'content-type': 'application/json' },
    rawHeaders: [],
    cookies: [],
    body: '{"error":"boom tok-very-secret"}',
    isBinary: false,
    contentType: 'application/json',
    sizeBytes: 10,
    transferSizeBytes: 10,
    timings: { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, downloadMs: 0, totalMs: 42 },
    tls: null,
    redirects: [],
    captures: [],
    assertions: [],
    sentHeaders: {},
    ...overrides,
  };
}

describe('collectAuthSecretValues', () => {
  it('collects literal credentials but skips {{variable}} templates', () => {
    expect(
      collectAuthSecretValues({
        type: 'bearer',
        bearer: { token: 'abc-123-token' },
        basic: { username: 'u', password: '{{pw}}' },
        apikey: { key: 'k', value: 'api-value-1', in: 'header' },
        oauth2: { grantType: 'password', accessTokenUrl: '', clientId: 'c', clientSecret: 'cs-secret', password: 'pw-secret' },
      }).sort(),
    ).toEqual(['abc-123-token', 'api-value-1', 'cs-secret', 'pw-secret'].sort());
    expect(collectAuthSecretValues(undefined)).toEqual([]);
  });
});

describe('buildAiChatContext', () => {
  it('keeps requests templated, lists env variable names only, and gathers secret values', () => {
    const request = createDefaultHttpRequest({
      url: '{{baseUrl}}/users',
      method: 'POST',
      auth: { type: 'bearer', bearer: { token: 'bearer-literal-1' } },
      body: { mode: 'json', content: '{"a":1}' },
    });
    const ctx = buildAiChatContext({ request, response: response(), environment: env });
    expect(ctx.request?.url).toBe('{{baseUrl}}/users');
    expect(ctx.request?.bodyMode).toBe('json');
    expect(ctx.request?.body).toBe('{"a":1}');
    expect(ctx.environmentVariableNames).toEqual(['baseUrl', 'apiToken']);
    expect(ctx.secretValues).toEqual(expect.arrayContaining(['tok-very-secret', 'bearer-literal-1']));
    expect(ctx.response?.status).toBe(500);
    expect(ctx.response?.totalMs).toBe(42);
    expect(JSON.stringify(ctx.environmentVariableNames)).not.toContain('tok-very-secret');
  });

  it('feeds the system prompt such that secrets are scrubbed end-to-end', () => {
    const ctx = buildAiChatContext({
      request: createDefaultHttpRequest(),
      response: response(),
      environment: env,
    });
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).not.toContain('tok-very-secret');
    expect(prompt).toContain('Status: 500 Server Error');
  });

  it('captures GraphQL query and variables instead of a body', () => {
    const request = createDefaultGraphQLRequest();
    request.graphql = { query: '{ me { id } }', variables: '{"a":1}' };
    const ctx = buildAiChatContext({ request });
    expect(ctx.request?.graphqlQuery).toBe('{ me { id } }');
    expect(ctx.request?.graphqlVariables).toBe('{"a":1}');
    expect(ctx.request?.body).toBeUndefined();
  });

  it('serializes form bodies and omits binary response bodies', () => {
    const request = createDefaultHttpRequest({
      body: {
        mode: 'form-urlencoded',
        urlEncoded: [
          { key: 'a', value: '1', enabled: true },
          { key: 'off', value: '2', enabled: false },
        ],
      },
    });
    const ctx = buildAiChatContext({ request, response: response({ isBinary: true, body: 'AAAA' }) });
    expect(ctx.request?.body).toBe('a=1');
    expect(ctx.response?.body).toBe('<binary body omitted>');
  });

  it('works with no request, response, or environment', () => {
    expect(buildAiChatContext({})).toEqual({ secretValues: [] });
  });

  it('includes extra secrets and an optional schema', () => {
    const ctx = buildAiChatContext({ extraSecretValues: ['extra-secret'], graphqlSchemaSdl: 'type Query { a: Int }' });
    expect(ctx.secretValues).toEqual(['extra-secret']);
    expect(ctx.graphqlSchemaSdl).toContain('type Query');
  });
});

describe('buildAiChatContext masking', () => {
  it('blanks flagged or credential-like header and query values before they leave the renderer', () => {
    const request = createDefaultHttpRequest({
      headers: [
        { key: 'Authorization', value: 'Bearer abc123456', enabled: true },
        { key: 'X-Flagged', value: 'flag-value-1', enabled: true, secret: true },
        { key: 'Accept', value: 'application/json', enabled: true },
        { key: 'X-Token', value: '{{tok}}', enabled: true },
      ],
      queryParams: [{ key: 'api_key', value: 'qp-value-1', enabled: true }],
    });
    const ctx = buildAiChatContext({ request });
    const text = JSON.stringify(ctx.request);
    expect(text).not.toMatch(/abc123456|flag-value-1|qp-value-1/);
    expect(ctx.request?.headers?.find(h => h.key === 'Accept')?.value).toBe('application/json');
    expect(ctx.request?.headers?.find(h => h.key === 'X-Token')?.value).toBe('{{tok}}');
  });
});

describe('collectWorkspaceSecretValues', () => {
  it('finds secrets across environments, auth, profiles, folders, tabs and captures', () => {
    const collection = createEmptyCollection('C', {
      defaults: { auth: { type: 'bearer', bearer: { token: 'default-token-1' } }, headers: [{ key: 'X-Api-Key', value: 'hdr-secret-1', enabled: true }] },
      authProfiles: [{ id: 'p', name: 'P', type: 'basic', basic: { username: 'u', password: 'profile-pass-1' } }],
      environments: [{ id: 'e', name: 'dev', variables: [{ key: 'apiToken', value: 'env-token-1', enabled: true }, { key: 'plain', value: 'visible-value', enabled: true }] }],
      variables: [{ key: 'x', value: 'flagged-secret-1', enabled: true, secret: true }],
      items: [
        {
          kind: 'folder',
          id: 'f',
          name: 'F',
          auth: { type: 'apikey', apikey: { key: 'k', value: 'folder-key-1', in: 'header' } },
          items: [createDefaultHttpRequest({ queryParams: [{ key: 'api_key', value: 'qp-secret-1', enabled: true }] })],
        },
      ],
    });
    const tabRequest = createDefaultHttpRequest({ auth: { type: 'bearer', bearer: { token: 'tab-token-1' } } });
    const secrets = collectWorkspaceSecretValues({
      collections: [{ collection }],
      tabs: [{ request: tabRequest }],
      capturedVars: [{ key: 'authToken', value: 'captured-1', enabled: true }],
    });
    expect(secrets).toEqual(
      expect.arrayContaining([
        'default-token-1',
        'hdr-secret-1',
        'profile-pass-1',
        'env-token-1',
        'flagged-secret-1',
        'folder-key-1',
        'qp-secret-1',
        'tab-token-1',
        'captured-1',
      ]),
    );
    expect(secrets).not.toContain('visible-value');
  });
});

describe('hideFromAi', () => {
  it('masks flagged entries in the context and scrubs their values everywhere', () => {
    const request = createDefaultHttpRequest({
      url: '{{baseUrl}}/accounts?account=998877',
      headers: [{ key: 'X-Tenant', value: 'acme-corp', enabled: true, hideFromAi: true }],
      queryParams: [{ key: 'account', value: '998877', enabled: true, hideFromAi: true }],
      body: {
        mode: 'form-urlencoded',
        urlEncoded: [{ key: 'pin', value: '4321-pin', enabled: true, hideFromAi: true }],
      },
    });
    const flaggedEnv: EnvironmentConfig = {
      id: 'e2',
      name: 'dev',
      variables: [{ key: 'accountId', value: 'acct-555', enabled: true, hideFromAi: true }],
    };
    const context = buildAiChatContext({ request, environment: flaggedEnv });
    expect(context.secretValues).toEqual(expect.arrayContaining(['acct-555', 'acme-corp', '998877', '4321-pin']));
    const prompt = buildSystemPrompt(context);
    for (const hidden of ['acme-corp', '998877', '4321-pin']) expect(prompt).not.toContain(hidden);

    const workspace = collectWorkspaceSecretValues({
      collections: [{ collection: createEmptyCollection('C', { items: [request], environments: [flaggedEnv] }) }],
    });
    expect(workspace).toEqual(expect.arrayContaining(['acct-555', 'acme-corp', '998877', '4321-pin']));
  });
});
