import { describe, it, expect } from 'vitest';
import {
  convertPostmanTestScript,
  detectPostmanFileKind,
  importPostmanCollection,
  importPostmanEnvironment,
  importPostmanFiles,
} from './postmanImporter';
import { serializeCollectionToYaml } from './awjcSerializer';
import type { FolderItem, RequestItem } from './collectionSchema';
import sampleCollectionJson from '../../samples/postman/orders-and-inventory.postman_collection.json?raw';
import sampleLocalEnvJson from '../../samples/postman/local.postman_environment.json?raw';
import sampleProdEnvJson from '../../samples/postman/production.postman_environment.json?raw';

const SCHEMA_V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

function collectionDoc(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    info: { name: 'Shop API', schema: SCHEMA_V21, description: 'Storefront endpoints' },
    item: [],
    ...overrides,
  };
}

function firstRequest(items: unknown[]): RequestItem {
  return importPostmanCollection(collectionDoc({ item: items })).collection.items[0] as RequestItem;
}

describe('postmanImporter', () => {
  it('imports a v2.1 collection with folders, variables, collection auth, and metadata', () => {
    const { collection, warnings } = importPostmanCollection(
      JSON.stringify(
        collectionDoc({
          info: {
            name: 'Shop API',
            schema: SCHEMA_V21,
            description: { content: 'Storefront endpoints', type: 'text/markdown' },
            version: { major: 2, minor: 1, patch: 0 },
          },
          auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }] },
          variable: [
            { key: 'baseUrl', value: 'https://api.shop.test' },
            { key: 'unused', value: 'x', disabled: true },
          ],
          item: [
            {
              name: 'Orders',
              description: 'Order endpoints',
              auth: { type: 'noauth' },
              variable: [{ key: 'orderPrefix', value: 'ORD' }],
              item: [
                {
                  name: 'List orders',
                  request: { method: 'get', url: '{{baseUrl}}/orders' },
                },
              ],
            },
            { name: 'Health', request: '{{baseUrl}}/health' },
          ],
        }),
      ),
    );

    expect(warnings).toEqual([]);
    expect(collection.metadata).toMatchObject({
      name: 'Shop API',
      description: 'Storefront endpoints',
      version: '2.1.0',
    });
    expect(collection.defaults?.auth).toEqual({
      type: 'bearer',
      bearer: { token: '{{accessToken}}', prefix: 'Bearer' },
    });
    expect(collection.variables).toEqual([
      { key: 'baseUrl', value: 'https://api.shop.test', enabled: true },
      { key: 'unused', value: 'x', enabled: false },
    ]);
    expect(collection.environments).toEqual([]);

    const folder = collection.items[0] as FolderItem;
    expect(folder.kind).toBe('folder');
    expect(folder.name).toBe('Orders');
    expect(folder.description).toBe('Order endpoints');
    expect(folder.auth).toEqual({ type: 'none' });
    expect(folder.variables).toEqual([{ key: 'orderPrefix', value: 'ORD', enabled: true }]);

    const list = folder.items[0] as RequestItem;
    expect(list).toMatchObject({
      kind: 'request',
      protocol: 'http',
      name: 'List orders',
      method: 'GET',
      url: '{{baseUrl}}/orders',
      auth: { type: 'inherit' },
      body: { mode: 'none' },
    });

    const health = collection.items[1] as RequestItem;
    expect(health.url).toBe('{{baseUrl}}/health');
    expect(health.method).toBe('GET');
  });

  it('converts URL objects with query params (including disabled) and described path variables', () => {
    const req = firstRequest([
      {
        name: 'Get order',
        request: {
          method: 'GET',
          header: [
            { key: 'Accept', value: 'application/json' },
            { key: 'X-Debug', value: '1', disabled: true, description: 'debug only' },
          ],
          url: {
            raw: '{{baseUrl}}/orders/:orderId?expand=items',
            host: ['{{baseUrl}}'],
            path: ['orders', ':orderId'],
            query: [
              { key: 'expand', value: 'items' },
              { key: 'page', value: '2', disabled: true },
            ],
            variable: [{ key: 'orderId', value: '42', description: 'Order id' }],
          },
        },
      },
    ]);

    expect(req.url).toBe('{{baseUrl}}/orders/:orderId?expand=items');
    expect(req.queryParams).toEqual([
      { key: 'expand', value: 'items', enabled: true },
      { key: 'page', value: '2', enabled: false },
    ]);
    expect(req.pathParams).toEqual([{ key: 'orderId', value: '42', description: 'Order id' }]);
    expect(req.headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Debug', value: '1', enabled: false, description: 'debug only' },
    ]);
  });

  it('rebuilds the URL from its parts when `raw` is missing and parses string header blocks', () => {
    const req = firstRequest([
      {
        name: 'Legacy',
        request: {
          method: 'DELETE',
          header: 'Accept: application/json\n// X-Off: 1',
          url: {
            protocol: 'https',
            host: ['api', 'shop', 'test'],
            port: '8443',
            path: ['v1', 'carts'],
            query: [{ key: 'id', value: 'a b' }],
          },
        },
      },
    ]);
    expect(req.url).toBe('https://api.shop.test:8443/v1/carts?id=a%20b');
    expect(req.method).toBe('DELETE');
    expect(req.headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Off', value: '1', enabled: false },
    ]);
  });

  it('falls back to query params parsed from the raw URL when the structured list is absent', () => {
    const req = firstRequest([
      { name: 'Search', request: { method: 'GET', url: { raw: '{{baseUrl}}/search?q=shoes&limit=5' } } },
    ]);
    expect(req.queryParams?.map(p => [p.key, p.value])).toEqual([
      ['q', 'shoes'],
      ['limit', '5'],
    ]);
  });

  it('maps every supported body mode', () => {
    const items = [
      {
        name: 'JSON',
        request: {
          method: 'POST',
          url: 'u',
          body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
        },
      },
      {
        name: 'Raw by content type',
        request: {
          method: 'POST',
          url: 'u',
          header: [{ key: 'Content-Type', value: 'application/xml' }],
          body: { mode: 'raw', raw: '<a/>' },
        },
      },
      {
        name: 'Urlencoded',
        request: {
          method: 'POST',
          url: 'u',
          body: {
            mode: 'urlencoded',
            urlencoded: [
              { key: 'grant', value: 'x' },
              { key: 'off', value: 'y', disabled: true },
            ],
          },
        },
      },
      {
        name: 'Multipart',
        request: {
          method: 'POST',
          url: 'u',
          body: {
            mode: 'formdata',
            formdata: [
              { key: 'title', value: 'Hi', type: 'text' },
              { key: 'avatar', type: 'file', src: '/tmp/a.png', contentType: 'image/png' },
            ],
          },
        },
      },
      {
        name: 'Binary',
        request: { method: 'PUT', url: 'u', body: { mode: 'file', file: { src: '/tmp/blob.bin' } } },
      },
      {
        name: 'Disabled',
        request: { method: 'POST', url: 'u', body: { mode: 'raw', raw: 'x', disabled: true } },
      },
    ];
    const reqs = importPostmanCollection(collectionDoc({ item: items })).collection
      .items as RequestItem[];

    expect(reqs[0].body).toEqual({ mode: 'json', content: '{"a":1}' });
    expect(reqs[1].body).toEqual({ mode: 'xml', content: '<a/>' });
    expect(reqs[2].body).toEqual({
      mode: 'form-urlencoded',
      urlEncoded: [
        { key: 'grant', value: 'x', enabled: true },
        { key: 'off', value: 'y', enabled: false },
      ],
    });
    expect(reqs[3].body).toEqual({
      mode: 'multipart-form',
      formData: [
        { key: 'title', type: 'text', value: 'Hi', enabled: true },
        {
          key: 'avatar',
          type: 'file',
          filePath: '/tmp/a.png',
          contentType: 'image/png',
          enabled: true,
        },
      ],
    });
    expect(reqs[4].body).toEqual({ mode: 'binary', binaryFilePath: '/tmp/blob.bin' });
    expect(reqs[5].body).toEqual({ mode: 'none' });
  });

  it('converts GraphQL bodies into GraphQL requests and adds a Content-Type header', () => {
    const req = firstRequest([
      {
        name: 'Products',
        request: {
          method: 'POST',
          url: '{{baseUrl}}/graphql',
          body: {
            mode: 'graphql',
            graphql: { query: 'query { products { id } }', variables: '{"first": 5}' },
          },
        },
      },
    ]);
    expect(req.protocol).toBe('graphql');
    expect(req.graphql?.query).toBe('query { products { id } }');
    expect(req.graphql?.variables).toBe('{"first": 5}');
    expect(req.graphql?.schemaSource?.autoIntrospectOnOpen).toBe(false);
    expect(req.headers).toEqual([
      { key: 'Content-Type', value: 'application/json', enabled: true },
    ]);
    expect(req.body).toBeUndefined();
  });

  it('converts auth types and marks literal credentials as secret but leaves {{variable}} references alone', () => {
    const auths = [
      { type: 'basic', basic: [{ key: 'username', value: 'ann' }, { key: 'password', value: 'hunter2' }] },
      { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] },
      {
        type: 'apikey',
        apikey: [
          { key: 'key', value: 'api_key' },
          { key: 'value', value: 'sk_live_abc' },
          { key: 'in', value: 'query' },
        ],
      },
      { type: 'digest', digest: [{ key: 'username', value: 'd' }, { key: 'password', value: '{{pw}}' }, { key: 'realm', value: 'r' }] },
      {
        type: 'awsv4',
        awsv4: [
          { key: 'accessKey', value: 'AKIA1' },
          { key: 'secretKey', value: 'shh' },
          { key: 'region', value: 'eu-west-1' },
          { key: 'service', value: 's3' },
        ],
      },
      // v2.0 stores parameters as an object instead of a key/value list.
      { type: 'bearer', bearer: { token: 'abc123' } },
    ];
    const reqs = importPostmanCollection(
      collectionDoc({ item: auths.map((auth, i) => ({ name: `R${i}`, request: { url: 'u', auth } })) }),
    ).collection.items as RequestItem[];

    expect(reqs[0].auth).toEqual({
      type: 'basic',
      basic: { username: 'ann', password: 'hunter2', secret: true },
    });
    expect(reqs[1].auth).toEqual({ type: 'bearer', bearer: { token: '{{token}}', prefix: 'Bearer' } });
    expect(reqs[2].auth).toEqual({
      type: 'apikey',
      apikey: { key: 'api_key', value: 'sk_live_abc', in: 'query', secret: true },
    });
    expect(reqs[3].auth).toEqual({
      type: 'digest',
      digest: { username: 'd', password: '{{pw}}', realm: 'r' },
    });
    expect(reqs[4].auth).toEqual({
      type: 'awsv4',
      awsv4: {
        accessKeyId: 'AKIA1',
        secretAccessKey: 'shh',
        region: 'eu-west-1',
        service: 's3',
        secret: true,
      },
    });
    expect(reqs[5].auth).toEqual({
      type: 'bearer',
      bearer: { token: 'abc123', prefix: 'Bearer', secret: true },
    });
  });

  it('converts OAuth 2.0 configurations and reports unsupported auth', () => {
    const oauth = (params: Record<string, string>) => ({
      type: 'oauth2',
      oauth2: Object.entries(params).map(([key, value]) => ({ key, value })),
    });
    const { collection, warnings } = importPostmanCollection(
      collectionDoc({
        item: [
          {
            name: 'PKCE',
            request: {
              url: 'u',
              auth: oauth({
                grant_type: 'authorization_code_with_pkce',
                authUrl: 'https://id.test/authorize',
                accessTokenUrl: 'https://id.test/token',
                clientId: 'web',
                clientSecret: '{{clientSecret}}',
                redirect_uri: 'http://localhost/cb',
                scope: 'openid',
                challengeAlgorithm: 'S256',
                client_authentication: 'body',
              }),
            },
          },
          {
            name: 'Password',
            request: {
              url: 'u',
              auth: oauth({
                grant_type: 'password_credentials',
                accessTokenUrl: 'https://id.test/token',
                clientId: 'cli',
                clientSecret: 'literal-secret',
                username: 'bob',
                password: 'pw',
                client_authentication: 'header',
              }),
            },
          },
          { name: 'Token only', request: { url: 'u', auth: oauth({ accessToken: 'eyJabc' }) } },
          { name: 'Implicit', request: { url: 'u', auth: oauth({ grant_type: 'implicit', accessTokenUrl: 't' }) } },
          { name: 'NTLM', request: { url: 'u', auth: { type: 'ntlm', ntlm: [] } } },
        ],
      }),
    );
    const reqs = collection.items as RequestItem[];

    expect(reqs[0].auth).toEqual({
      type: 'oauth2',
      oauth2: {
        grantType: 'authorization_code_pkce',
        accessTokenUrl: 'https://id.test/token',
        authorizationUrl: 'https://id.test/authorize',
        redirectUri: 'http://localhost/cb',
        clientId: 'web',
        clientSecret: '{{clientSecret}}',
        scope: 'openid',
        clientAuthMethod: 'request_body',
        pkceCodeChallengeMethod: 'S256',
      },
    });
    expect(reqs[1].auth?.oauth2).toMatchObject({
      grantType: 'password',
      clientSecret: 'literal-secret',
      clientSecretIsSecret: true,
      username: 'bob',
      password: 'pw',
      passwordIsSecret: true,
      clientAuthMethod: 'basic_header',
    });
    expect(reqs[2].auth).toEqual({
      type: 'bearer',
      bearer: { token: 'eyJabc', prefix: 'Bearer', secret: true },
    });
    expect(reqs[3].auth?.oauth2?.grantType).toBe('authorization_code_pkce');
    expect(reqs[4].auth).toEqual({ type: 'none' });
    expect(warnings).toEqual([
      'OAuth 2.0 grant "implicit" is not supported and was converted to Authorization Code + PKCE (1: Implicit)',
      'Auth type "ntlm" is not supported and was set to No Auth (1: NTLM)',
    ]);
  });

  it('marks secret-typed and credential-named variables and headers as secret so saving strips them', () => {
    const { collection } = importPostmanCollection(
      collectionDoc({
        variable: [
          { key: 'password', value: 'p@ss' },
          { key: 'region', value: 'eu', type: 'secret' },
          { key: 'apiToken', value: '{{fromEnv}}' },
          { key: 'authBaseUrl', value: 'https://auth.shop.test' },
          { key: 'tokenUrl', value: 'https://bob:pw@auth.shop.test/token' },
        ],
        item: [
          {
            name: 'R',
            request: { url: 'u', header: [{ key: 'Authorization', value: 'Bearer abc.def' }] },
          },
        ],
      }),
    );
    expect(collection.variables).toEqual([
      { key: 'password', value: 'p@ss', enabled: true, secret: true },
      { key: 'region', value: 'eu', enabled: true, secret: true },
      { key: 'apiToken', value: '{{fromEnv}}', enabled: true },
      // Plain URLs are not credentials even under a sensitive-looking name; embedded user:pass is.
      { key: 'authBaseUrl', value: 'https://auth.shop.test', enabled: true },
      { key: 'tokenUrl', value: 'https://bob:pw@auth.shop.test/token', enabled: true, secret: true },
    ]);
    const req = collection.items[0] as RequestItem;
    expect(req.headers?.[0]).toMatchObject({ key: 'Authorization', secret: true });

    const serialized = serializeCollectionToYaml(collection);
    expect(serialized).not.toContain('p@ss');
    expect(serialized).not.toContain('abc.def');
  });

  it('rewrites Postman dynamic variables and reports the ones without an equivalent', () => {
    const { collection, warnings } = importPostmanCollection(
      collectionDoc({
        item: [
          {
            name: 'R',
            request: {
              url: '{{baseUrl}}/x?id={{$guid}}&ts={{$timestamp}}',
              header: [{ key: 'X-Req', value: '{{$randomUUID}}' }],
              body: { mode: 'raw', raw: '{"name":"{{$randomFirstName}}"}' },
            },
          },
        ],
      }),
    );
    const req = collection.items[0] as RequestItem;
    expect(req.url).toBe('{{baseUrl}}/x?id={{$uuid}}&ts={{$timestamp}}');
    expect(req.headers?.[0].value).toBe('{{$uuid}}');
    expect(req.body?.content).toBe('{"name":"{{$randomFirstName}}"}');
    expect(warnings).toContain(
      'Postman dynamic variables without an AwapiLasso equivalent were left as-is: $randomFirstName.',
    );
  });

  it('converts common test-script patterns into assertions and captures', () => {
    const script = [
      'pm.test("ok", function () { pm.response.to.have.status(201); });',
      'pm.expect(pm.response.code).to.eql(201);',
      'const json = pm.response.json();',
      'pm.environment.set("orderId", json.data.id);',
      "pm.collectionVariables.set('firstSku', json.items[0][\"sku-code\"]);",
      'pm.variables.set("token", pm.response.json().auth.token);',
      'pm.globals.set("etag", pm.response.headers.get("ETag"));',
    ].join('\n');

    expect(convertPostmanTestScript(script)).toEqual({
      assertions: [{ target: 'status', operator: 'equals', expected: 201, enabled: true }],
      captures: [
        { variable: 'orderId', scope: 'environment', source: 'jsonpath', expression: '$.data.id', enabled: true },
        {
          variable: 'firstSku',
          scope: 'collection',
          source: 'jsonpath',
          expression: "$.items[0]['sku-code']",
          enabled: true,
        },
        { variable: 'token', scope: 'runtime', source: 'jsonpath', expression: '$.auth.token', enabled: true },
        { variable: 'etag', scope: 'collection', source: 'header', expression: 'ETag', enabled: true },
      ],
      fullyConverted: true,
    });
    expect(convertPostmanTestScript('')).toEqual({ assertions: [], captures: [], fullyConverted: true });
    expect(convertPostmanTestScript('var d = JSON.parse(responseBody); pm.environment.set("x", d.y);').captures).toEqual([
      { variable: 'x', scope: 'environment', source: 'jsonpath', expression: '$.y', enabled: true },
    ]);
    const partial = convertPostmanTestScript(
      [
        '// check',
        'pm.test("ok", () => {',
        '  pm.response.to.have.status(200);',
        '  pm.expect(pm.response.json().ok).to.be.true;',
        '});',
      ].join('\n'),
    );
    expect(partial.assertions).toHaveLength(1);
    expect(partial.fullyConverted).toBe(false);
  });

  it('attaches converted scripts to requests and groups script warnings', () => {
    const event = (listen: string, exec: string[]) => ({ listen, script: { type: 'text/javascript', exec } });
    const { collection, warnings } = importPostmanCollection(
      collectionDoc({
        event: [event('prerequest', ['console.log(1)'])],
        item: [
          {
            name: 'Login',
            event: [
              event('test', [
                '// Login check',
                'pm.test("logged in", function () {',
                '  pm.response.to.have.status(200);',
                '});',
                'pm.environment.set("token", pm.response.json().token);',
              ]),
            ],
            request: { method: 'POST', url: 'u' },
          },
          {
            name: 'Partial',
            event: [event('test', ['pm.response.to.have.status(200);', 'if (pm.response.json().retry) postman.setNextRequest("Login");'])],
            request: { url: 'u' },
          },
          {
            name: 'Signed',
            event: [event('prerequest', ['pm.request.headers.add("X-Sig", sign())'])],
            request: { url: 'u' },
          },
          {
            name: 'Custom',
            event: [event('test', ['console.log(pm.response.text())'])],
            request: { url: 'u' },
          },
          { name: 'Empty', event: [event('test', [''])], request: { url: 'u' } },
        ],
      }),
    );

    const login = collection.items[0] as RequestItem;
    expect(login.assertions).toEqual([
      { target: 'status', operator: 'equals', expected: 200, enabled: true },
    ]);
    expect(login.captures).toEqual([
      { variable: 'token', scope: 'environment', source: 'jsonpath', expression: '$.token', enabled: true },
    ]);
    expect(warnings).toEqual([
      'Collection-level scripts were not imported.',
      'Test scripts were partly converted to assertions/captures; review them (1: Partial)',
      'Pre-request scripts were not imported (1: Signed)',
      'Test scripts were not imported (1: Custom)',
    ]);
  });

  it('lists at most five item names per grouped warning', () => {
    const items = Array.from({ length: 7 }, (_, i) => ({
      name: `R${i}`,
      request: { url: 'u', auth: { type: 'hawk' } },
    }));
    const { warnings } = importPostmanCollection(collectionDoc({ item: items }));
    expect(warnings).toEqual([
      'Auth type "hawk" is not supported and was set to No Auth (7: R0, R1, R2, R3, R4, +2 more)',
    ]);
  });

  it('imports environment exports with enabled flags and secret values', () => {
    const env = importPostmanEnvironment(
      JSON.stringify({
        id: 'e1',
        name: 'Staging',
        values: [
          { key: 'baseUrl', value: 'https://staging.shop.test', enabled: true, type: 'default' },
          { key: 'clientSecret', value: 'abc', enabled: true, type: 'secret' },
          { key: 'old', value: '1', enabled: false },
        ],
        _postman_variable_scope: 'environment',
      }),
      '#3b82f6',
    );
    expect(env.name).toBe('Staging');
    expect(env.color).toBe('#3b82f6');
    expect(env.variables).toEqual([
      { key: 'baseUrl', value: 'https://staging.shop.test', enabled: true },
      { key: 'clientSecret', value: 'abc', enabled: true, secret: true },
      { key: 'old', value: '1', enabled: false },
    ]);
    expect(() => importPostmanEnvironment('{"item": []}')).toThrow(/Not a Postman environment/);
  });

  it('detects Postman file kinds', () => {
    expect(detectPostmanFileKind(collectionDoc())).toBe('collection');
    expect(detectPostmanFileKind({ name: 'Dev', values: [], _postman_variable_scope: 'environment' })).toBe('environment');
    expect(detectPostmanFileKind({ values: [], _postman_variable_scope: 'globals' })).toBe('globals');
    expect(detectPostmanFileKind({ openapi: '3.0.0' })).toBe('unknown');
    expect(detectPostmanFileKind([])).toBe('unknown');
  });

  it('imports a collection picked together with environment and globals files', () => {
    const { collection, collectionFile } = importPostmanFiles([
      {
        name: 'dev.postman_environment.json',
        content: JSON.stringify({ name: 'Dev', values: [{ key: 'baseUrl', value: 'http://localhost', enabled: true }] }),
      },
      {
        name: 'shop.postman_collection.json',
        content: JSON.stringify(collectionDoc({ variable: [{ key: 'region', value: 'eu' }] })),
      },
      {
        name: 'prod.postman_environment.json',
        content: JSON.stringify({ name: 'Prod', values: [], _postman_variable_scope: 'environment' }),
      },
      {
        name: 'globals.json',
        content: JSON.stringify({
          _postman_variable_scope: 'globals',
          values: [
            { key: 'region', value: 'us', enabled: true },
            { key: 'tenant', value: 'acme', enabled: true },
          ],
        }),
      },
    ]);

    expect(collection.environments?.map(e => [e.name, e.color])).toEqual([
      ['Dev', '#22c55e'],
      ['Prod', '#3b82f6'],
    ]);
    expect(collection.activeEnvironment).toBe('Dev');
    expect(collectionFile).toBe('shop.postman_collection.json');
    // Collection variables win over globals with the same key.
    expect(collection.variables).toEqual([
      { key: 'region', value: 'eu', enabled: true },
      { key: 'tenant', value: 'acme', enabled: true },
    ]);
  });

  it('imports the samples/postman exports and reports exactly the features they cannot carry over', () => {
    const { collection, warnings, collectionFile } = importPostmanFiles([
      { name: 'local.postman_environment.json', content: sampleLocalEnvJson },
      { name: 'orders-and-inventory.postman_collection.json', content: sampleCollectionJson },
      { name: 'production.postman_environment.json', content: sampleProdEnvJson },
    ]);

    expect(collectionFile).toBe('orders-and-inventory.postman_collection.json');
    expect(warnings).toEqual([
      'Collection-level scripts were not imported.',
      'Postman dynamic variables without an AwapiLasso equivalent were left as-is: $randomFullName.',
      'Pre-request scripts were not imported (1: Delete Order)',
      'Auth type "ntlm" is not supported and was set to No Auth (1: NTLM (unsupported))',
    ]);
    expect(collection.defaults?.auth?.oauth2).toMatchObject({
      grantType: 'client_credentials',
      clientAuthMethod: 'basic_header',
    });
    expect(collection.environments?.map(e => e.name)).toEqual(['local', 'production']);
    expect(
      collection.environments?.[0].variables.filter(v => v.secret).map(v => v.key),
    ).toEqual(['clientSecret', 'apiPassword', 'apiKey', 'bearerToken']);

    const [orders, graphql, authPlayground, echo] = collection.items as [
      FolderItem,
      FolderItem,
      FolderItem,
      RequestItem,
    ];
    expect(orders.items).toHaveLength(9);
    const create = orders.items.find(i => i.name === 'Create Order') as RequestItem;
    expect(create.auth?.oauth2?.grantType).toBe('password');
    expect(create.headers?.find(h => h.key === 'X-Request-Id')?.value).toBe('{{$uuid}}');
    expect(create.captures?.map(c => [c.variable, c.source, c.expression])).toEqual([
      ['lastOrderId', 'jsonpath', '$.data.id'],
      ['orderLocation', 'header', 'Location'],
    ]);
    expect(graphql.items.every(i => i.kind === 'request' && i.protocol === 'graphql')).toBe(true);
    expect(authPlayground.auth).toEqual({ type: 'none' });
    const literalKey = authPlayground.items.find(i => i.name === 'API Key (query, literal value)') as RequestItem;
    expect(literalKey.auth?.apikey).toMatchObject({ in: 'query', secret: true });
    expect(echo.body).toEqual({ mode: 'text', content: 'Hello from Postman at {{$timestamp}}' });
  });

  it('rejects invalid selections with actionable messages', () => {
    const col = { name: 'a.json', content: JSON.stringify(collectionDoc()) };
    const env = { name: 'e.json', content: JSON.stringify({ name: 'E', values: [] }) };

    expect(() => importPostmanFiles([env])).toThrow(/No Postman collection selected/);
    expect(() => importPostmanFiles([col, { ...col, name: 'b.json' }])).toThrow(
      /"a.json" and "b.json" are both collections/,
    );
    expect(() => importPostmanFiles([{ name: 'bad.json', content: '{nope' }])).toThrow(
      /"bad.json" is not valid JSON/,
    );
    expect(() => importPostmanFiles([{ name: 'spec.json', content: '{"openapi":"3.0.0"}' }])).toThrow(
      /"spec.json" is not a Postman collection, environment, or globals export/,
    );
    expect(() =>
      importPostmanFiles([{ name: 'v1.json', content: '{"name":"Old","requests":[],"order":[]}' }]),
    ).toThrow(/Postman Collection v1 is not supported/);
    expect(() => importPostmanCollection({ info: {} })).toThrow(/Not a Postman collection/);
  });
});
