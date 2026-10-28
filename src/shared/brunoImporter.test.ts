import { describe, it, expect } from 'vitest';
import {
  convertBrunoScript,
  importBrunoCollectionFiles,
  importBrunoExport,
  parseBrunoCollectionFiles,
  type BrunoSourceFile,
} from './brunoImporter';
import { serializeCollectionToYaml } from './awjcSerializer';
import type { FolderItem, RequestItem } from './collectionSchema';

const bru = (...lines: string[]) => `${lines.join('\n')}\n`;

function shopFolder(): BrunoSourceFile[] {
  return [
    { path: 'bruno.json', content: JSON.stringify({ version: '1', name: 'Shop API', type: 'collection' }) },
    {
      path: 'collection.bru',
      content: bru(
        'headers {',
        '  X-Client: awapi',
        '}',
        '',
        'auth {',
        '  mode: oauth2',
        '}',
        '',
        'auth:oauth2 {',
        '  grant_type: client_credentials',
        '  access_token_url: {{authBaseUrl}}/oauth/token',
        '  client_id: {{clientId}}',
        '  client_secret: {{clientSecret}}',
        '  scope: orders:read',
        '  credentials_placement: basic_auth_header',
        '  token_placement: header',
        '  token_header_prefix: Bearer',
        '  auto_refresh_token: true',
        '}',
        '',
        'vars:pre-request {',
        '  apiVersion: v1',
        '}',
        '',
        'docs {',
        '  Storefront endpoints',
        '}',
      ),
    },
    {
      path: 'environments/local.bru',
      content: bru(
        'vars {',
        '  baseUrl: http://localhost:8080',
        '  authBaseUrl: http://localhost:8080',
        '  ~legacy: 1',
        '}',
        'vars:secret [',
        '  clientSecret',
        ']',
      ),
    },
    { path: 'environments/prod.bru', content: bru('vars {', '  baseUrl: https://api.shop.test', '}') },
    {
      path: 'Orders/folder.bru',
      content: bru(
        'meta {',
        '  name: Orders',
        '  seq: 1',
        '}',
        '',
        'headers {',
        '  X-Area: orders',
        '}',
        '',
        'auth {',
        '  mode: inherit',
        '}',
        '',
        'vars:pre-request {',
        '  orderPrefix: ORD',
        '}',
      ),
    },
    {
      path: 'Orders/Create Order.bru',
      content: bru(
        'meta {',
        '  name: Create Order',
        '  type: http',
        '  seq: 2',
        '}',
        '',
        'post {',
        '  url: {{baseUrl}}/{{apiVersion}}/orders',
        '  body: json',
        '  auth: inherit',
        '}',
        '',
        'headers {',
        '  Content-Type: application/json',
        '  X-Request-Id: {{$guid}}',
        '}',
        '',
        'body:json {',
        '  {',
        '    "sku": "SKU-100"',
        '  }',
        '}',
        '',
        'vars:post-response {',
        '  lastOrderId: res.body.data.id',
        '  location: res.headers.location',
        '}',
        '',
        'assert {',
        '  res.status: in [200, 201]',
        '  res.body.data.id: isDefined',
        '  ~res.responseTime: lt 500',
        '}',
        '',
        'script:post-response {',
        '  bru.setEnvVar("orderId", res.body.data.id);',
        '}',
        '',
        'tests {',
        '  test("created", function () {',
        '    expect(res.status).to.equal(201);',
        '  });',
        '}',
        '',
        'docs {',
        '  Creates an order.',
        '}',
      ),
    },
    {
      path: 'Orders/Get Order.bru',
      content: bru(
        'meta {',
        '  name: Get Order',
        '  type: http',
        '  seq: 1',
        '}',
        '',
        'get {',
        '  url: {{baseUrl}}/{{apiVersion}}/orders/:orderId?expand=items',
        '  body: none',
        '  auth: none',
        '}',
        '',
        'params:query {',
        '  expand: items',
        '  ~page: 2',
        '}',
        '',
        'params:path {',
        '  orderId: {{lastOrderId}}',
        '}',
      ),
    },
    {
      path: 'Orders/Attachments/Upload.bru',
      content: bru(
        'meta {',
        '  name: Upload',
        '  type: http',
        '  seq: 1',
        '}',
        '',
        'post {',
        '  url: {{baseUrl}}/orders/:orderId/attachments',
        '  body: multipartForm',
        '  auth: inherit',
        '}',
        '',
        'body:multipart-form {',
        '  documentType: invoice',
        '  file: @file(files/invoice.pdf) @contentType(application/pdf)',
        '  ~extra: @file(a.png|b.png)',
        '}',
      ),
    },
    {
      path: 'GraphQL Products.bru',
      content: bru(
        'meta {',
        '  name: Products',
        '  type: graphql',
        '  seq: 5',
        '}',
        '',
        'post {',
        '  url: {{baseUrl}}/graphql',
        '  body: graphql',
        '  auth: inherit',
        '}',
        '',
        'body:graphql {',
        '  query Products($first: Int) {',
        '    products(first: $first) { id }',
        '  }',
        '}',
        '',
        'body:graphql:vars {',
        '  { "first": 5 }',
        '}',
      ),
    },
  ];
}

describe('brunoImporter', () => {
  it('imports a Bruno collection folder with folders, environments, collection auth, and variables', () => {
    const { collection, warnings } = importBrunoCollectionFiles(shopFolder());

    expect(collection.metadata).toMatchObject({ name: 'Shop API', description: 'Storefront endpoints' });
    expect(collection.defaults?.headers).toEqual([{ key: 'X-Client', value: 'awapi', enabled: true }]);
    expect(collection.defaults?.auth).toEqual({
      type: 'oauth2',
      oauth2: {
        grantType: 'client_credentials',
        accessTokenUrl: '{{authBaseUrl}}/oauth/token',
        clientId: '{{clientId}}',
        clientSecret: '{{clientSecret}}',
        scope: 'orders:read',
        clientAuthMethod: 'basic_header',
        tokenHeaderPrefix: 'Bearer',
        autoRefresh: true,
      },
    });
    expect(collection.variables).toEqual([{ key: 'apiVersion', value: 'v1', enabled: true }]);
    expect(collection.activeEnvironment).toBe('local');
    expect(collection.environments?.map(e => e.name)).toEqual(['local', 'prod']);
    expect(collection.environments?.[0].variables).toEqual([
      { key: 'baseUrl', value: 'http://localhost:8080', enabled: true },
      { key: 'authBaseUrl', value: 'http://localhost:8080', enabled: true },
      { key: 'legacy', value: '1', enabled: false },
      { key: 'clientSecret', value: '', enabled: true, secret: true },
    ]);

    // Folders first, then requests; each ordered by seq.
    expect(collection.items.map(i => i.name)).toEqual(['Orders', 'Products']);
    const orders = collection.items[0] as FolderItem;
    expect(orders.headers).toEqual([{ key: 'X-Area', value: 'orders', enabled: true }]);
    expect(orders.auth).toEqual({ type: 'inherit' });
    expect(orders.variables).toEqual([{ key: 'orderPrefix', value: 'ORD', enabled: true }]);
    expect(orders.items.map(i => i.name)).toEqual(['Attachments', 'Get Order', 'Create Order']);

    expect(warnings).toEqual([
      'File paths are relative to the Bruno collection folder; check them (1: Upload)',
      'Only the first file of multi-file form fields was kept (1: Upload)',
    ]);
  });

  it('converts URLs, params, auth modes, and bodies of .bru requests', () => {
    const orders = importBrunoCollectionFiles(shopFolder()).collection.items[0] as FolderItem;
    const get = orders.items.find(i => i.name === 'Get Order') as RequestItem;
    expect(get).toMatchObject({
      method: 'GET',
      url: '{{baseUrl}}/{{apiVersion}}/orders/:orderId?expand=items',
      auth: { type: 'none' },
      body: { mode: 'none' },
    });
    expect(get.queryParams).toEqual([
      { key: 'expand', value: 'items', enabled: true },
      { key: 'page', value: '2', enabled: false },
    ]);
    expect(get.pathParams).toEqual([{ key: 'orderId', value: '{{lastOrderId}}' }]);

    const create = orders.items.find(i => i.name === 'Create Order') as RequestItem;
    expect(create.description).toBe('Creates an order.');
    expect(create.auth).toEqual({ type: 'inherit' });
    expect(create.body).toEqual({ mode: 'json', content: '{\n  "sku": "SKU-100"\n}' });
    expect(create.headers?.[1]).toEqual({ key: 'X-Request-Id', value: '{{$uuid}}', enabled: true });

    const upload = (orders.items[0] as FolderItem).items[0] as RequestItem;
    expect(upload.body).toEqual({
      mode: 'multipart-form',
      formData: [
        { key: 'documentType', type: 'text', value: 'invoice', enabled: true },
        { key: 'file', type: 'file', filePath: 'files/invoice.pdf', contentType: 'application/pdf', enabled: true },
        { key: 'extra', type: 'file', filePath: 'a.png', enabled: false },
      ],
    });
  });

  it('turns assertions, post-response vars, and script idioms into assertions and captures', () => {
    const orders = importBrunoCollectionFiles(shopFolder()).collection.items[0] as FolderItem;
    const create = orders.items.find(i => i.name === 'Create Order') as RequestItem;
    expect(create.assertions).toEqual([
      { target: 'status', operator: 'in', expected: [200, 201], enabled: true },
      { target: 'jsonpath', path: '$.data.id', operator: 'isDefined', enabled: true },
      { target: 'responseTime', operator: 'lessThan', expected: 500, enabled: false },
      { target: 'status', operator: 'equals', expected: 201, enabled: true },
    ]);
    expect(create.captures).toEqual([
      { variable: 'lastOrderId', scope: 'runtime', source: 'jsonpath', expression: '$.data.id', enabled: true },
      { variable: 'location', scope: 'runtime', source: 'header', expression: 'location', enabled: true },
      { variable: 'orderId', scope: 'environment', source: 'jsonpath', expression: '$.data.id', enabled: true },
    ]);
  });

  it('imports GraphQL requests', () => {
    const products = importBrunoCollectionFiles(shopFolder()).collection.items[1] as RequestItem;
    expect(products.protocol).toBe('graphql');
    expect(products.graphql?.query).toBe('query Products($first: Int) {\n  products(first: $first) { id }\n}');
    expect(products.graphql?.variables).toBe('{ "first": 5 }');
    expect(products.headers).toEqual([{ key: 'Content-Type', value: 'application/json', enabled: true }]);
  });

  it('reports what it cannot convert', () => {
    const files: BrunoSourceFile[] = [
      { path: 'bruno.json', content: '{"name":"X"}' },
      {
        path: 'collection.bru',
        content: bru('script:pre-request {', '  console.log(1)', '}'),
      },
      {
        path: 'Odd.bru',
        content: bru(
          'meta {',
          '  name: Odd',
          '}',
          'get {',
          '  url: {{process.env.HOST}}/x?u={{$randomCity}}',
          '  auth: ntlm',
          '}',
          'auth:ntlm {',
          '  username: a',
          '}',
          'vars:pre-request {',
          '  local: 1',
          '}',
          'vars:post-response {',
          '  total: res.body.items.length * 2',
          '}',
          'assert {',
          '  res.body.count: gte 1',
          '  custom(): eq 1',
          '}',
          'script:pre-request {',
          '  req.setHeader("X-Sig", sign());',
          '}',
          'tests {',
          '  expect(res.status).to.equal(200);',
          '  expect(res.body.ok).to.be.true;',
          '}',
        ),
      },
    ];
    const { collection, warnings } = importBrunoCollectionFiles(files);
    expect((collection.items[0] as RequestItem).auth).toEqual({ type: 'none' });
    expect(warnings).toEqual([
      'Collection-level scripts were not imported.',
      'Dynamic variables without an AwapiLasso equivalent were left as-is: $randomCity.',
      '{{process.env.*}} variables (from the Bruno .env file) were left as-is; define them as variables.',
      'Auth type "ntlm" is not supported and was set to No Auth (1: Odd)',
      'Pre-request scripts were not imported (1: Odd)',
      'Request variables were not imported (1: Odd)',
      'Assertions using "gte" were not imported (1: Odd)',
      'Assertions on custom expressions were not imported (1: Odd)',
      'Post-response variables with custom expressions were not imported (1: Odd)',
      'Tests were partly converted to assertions/captures; review them (1: Odd)',
    ]);
  });

  it('marks literal credentials as secret so saving keeps them out of the file', () => {
    const files: BrunoSourceFile[] = [
      { path: 'bruno.json', content: '{"name":"Secrets"}' },
      { path: 'environments/dev.bru', content: bru('vars {', '  apiToken: tok_live_123', '}') },
      {
        path: 'Basic.bru',
        content: bru(
          'get {',
          '  url: https://x.test',
          '  auth: basic',
          '}',
          'auth:basic {',
          '  username: ann',
          '  password: hunter2',
          '}',
          'headers {',
          '  Authorization: Bearer abc.def',
          '}',
        ),
      },
      {
        path: 'Key.bru',
        content: bru(
          'get {',
          '  url: https://x.test',
          '  auth: apikey',
          '}',
          'auth:apikey {',
          '  key: api_key',
          '  value: {{apiKey}}',
          '  placement: queryparams',
          '}',
        ),
      },
    ];
    const { collection } = importBrunoCollectionFiles(files);
    const [basic, key] = collection.items as RequestItem[];
    expect(basic.name).toBe('Basic');
    expect(basic.auth).toEqual({ type: 'basic', basic: { username: 'ann', password: 'hunter2', secret: true } });
    expect(basic.headers?.[0]).toMatchObject({ key: 'Authorization', secret: true });
    expect(key.auth).toEqual({ type: 'apikey', apikey: { key: 'api_key', value: '{{apiKey}}', in: 'query' } });
    expect(collection.environments?.[0].variables[0]).toMatchObject({ key: 'apiToken', secret: true });

    const yaml = serializeCollectionToYaml(collection);
    expect(yaml).not.toContain('hunter2');
    expect(yaml).not.toContain('abc.def');
    expect(yaml).not.toContain('tok_live_123');
  });

  it('converts Bruno script idioms', () => {
    expect(
      convertBrunoScript(
        [
          'test("ok", () => {',
          '  expect(res.getStatus()).to.eql(200);',
          '});',
          'const data = res.getBody();',
          'bru.setVar("id", data.items[0].id);',
          'bru.setGlobalEnvVar("etag", res.getHeader("ETag"));',
        ].join('\n'),
      ),
    ).toEqual({
      assertions: [{ target: 'status', operator: 'equals', expected: 200, enabled: true }],
      captures: [
        { variable: 'id', scope: 'runtime', source: 'jsonpath', expression: '$.items[0].id', enabled: true },
        { variable: 'etag', scope: 'collection', source: 'header', expression: 'ETag', enabled: true },
      ],
      fullyConverted: true,
    });
  });

  it('imports a Bruno JSON export', () => {
    const { collection, warnings } = importBrunoExport(
      JSON.stringify({
        version: '1',
        name: 'Exported',
        items: [
          {
            type: 'folder',
            name: 'Users',
            root: { request: { auth: { mode: 'bearer', bearer: { token: '{{token}}' } } } },
            items: [
              {
                type: 'http-request',
                name: 'Login',
                seq: 1,
                request: {
                  url: '{{baseUrl}}/login',
                  method: 'POST',
                  headers: [{ name: 'Accept', value: 'application/json', enabled: true }],
                  params: [],
                  body: {
                    mode: 'formUrlEncoded',
                    formUrlEncoded: [
                      { name: 'user', value: 'ann', enabled: true },
                      { name: 'otp', value: '', enabled: false },
                    ],
                  },
                  auth: {
                    mode: 'oauth2',
                    oauth2: {
                      grantType: 'authorization_code',
                      pkce: true,
                      authorizationUrl: 'https://id.test/authorize',
                      accessTokenUrl: 'https://id.test/token',
                      callbackUrl: 'http://localhost/cb',
                      clientId: 'web',
                      clientSecret: '',
                      credentialsPlacement: 'body',
                    },
                  },
                  vars: { req: [], res: [{ name: 'session', value: 'res("data.session")', enabled: true }] },
                  assertions: [{ name: 'res.status', value: 'eq 200', enabled: true }],
                  script: {},
                },
              },
              {
                type: 'http-request',
                name: 'Upload avatar',
                request: {
                  url: '{{baseUrl}}/avatar',
                  method: 'PUT',
                  body: {
                    mode: 'file',
                    file: [
                      { filePath: 'old.png', contentType: 'image/png', selected: false },
                      { filePath: '/abs/new.png', contentType: 'image/png', selected: true },
                    ],
                  },
                  auth: { mode: 'inherit' },
                },
              },
            ],
          },
        ],
        environments: [
          {
            name: 'dev',
            variables: [
              { name: 'baseUrl', value: 'http://localhost', enabled: true, secret: false },
              { name: 'token', value: '', enabled: true, secret: true },
            ],
          },
        ],
      }),
    );

    const folder = collection.items[0] as FolderItem;
    expect(folder.auth).toEqual({ type: 'bearer', bearer: { token: '{{token}}', prefix: 'Bearer' } });
    const [login, upload] = folder.items as RequestItem[];
    expect(login.body).toEqual({
      mode: 'form-urlencoded',
      urlEncoded: [
        { key: 'user', value: 'ann', enabled: true },
        { key: 'otp', value: '', enabled: false },
      ],
    });
    expect(login.auth?.oauth2).toEqual({
      grantType: 'authorization_code_pkce',
      accessTokenUrl: 'https://id.test/token',
      clientId: 'web',
      authorizationUrl: 'https://id.test/authorize',
      redirectUri: 'http://localhost/cb',
      clientAuthMethod: 'request_body',
      pkceCodeChallengeMethod: 'S256',
    });
    expect(login.captures).toEqual([
      { variable: 'session', scope: 'runtime', source: 'jsonpath', expression: '$.data.session', enabled: true },
    ]);
    expect(login.assertions).toEqual([{ target: 'status', operator: 'equals', expected: 200, enabled: true }]);
    expect(upload.body).toEqual({ mode: 'binary', binaryFilePath: '/abs/new.png', contentType: 'image/png' });
    expect(collection.environments?.[0].variables[1]).toEqual({ key: 'token', value: '', enabled: true, secret: true });
    expect(warnings).toEqual([
      'File paths are relative to the Bruno collection folder; check them (1: Upload avatar)',
    ]);
  });

  it('rejects inputs that are not Bruno collections', () => {
    expect(() => parseBrunoCollectionFiles([{ path: 'a.bru', content: '' }])).toThrow(/bruno.json was not found/);
    expect(() => parseBrunoCollectionFiles([{ path: 'bruno.json', content: '{nope' }])).toThrow(
      /bruno.json is not valid JSON/,
    );
    expect(() => importBrunoExport('{nope')).toThrow(/not valid JSON/);
    expect(() => importBrunoExport({ openapi: '3.0.0' })).toThrow(/Not a Bruno collection export/);
    expect(() => importBrunoExport({ info: { name: 'P' }, item: [] })).toThrow(/Import from Postman/);
  });

  it('accepts Windows-style paths and falls back to file names without meta', () => {
    const data = parseBrunoCollectionFiles([
      { path: 'bruno.json', content: '{}' },
      { path: 'Users\\List users.bru', content: bru('get {', '  url: https://x.test/users', '}') },
    ]);
    expect(data.name).toBe('Imported Bruno Collection');
    const { collection } = importBrunoCollectionFiles([
      { path: 'bruno.json', content: '{}' },
      { path: 'Users\\List users.bru', content: bru('get {', '  url: https://x.test/users', '}') },
    ]);
    const folder = collection.items[0] as FolderItem;
    expect(folder.name).toBe('Users');
    expect(folder.items[0]).toMatchObject({ name: 'List users', method: 'GET', url: 'https://x.test/users' });
  });
});
