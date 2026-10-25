import * as fs from 'fs';
import * as path from 'path';
import { getIntrospectionQuery } from 'graphql';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createSampleApiServer, type SampleApiServerInstance } from './server';
import { executeHttpRequest } from '../src/main/httpEngine';
import { acquireOAuth2Token, clearAllMemoryOAuth2Tokens } from '../src/main/oauth2Engine';
import { parseCollectionFile } from '../src/shared/awjcSerializer';
import type { FolderItem, RequestItem, VariableEntry } from '../src/shared/collectionSchema';

describe('sample-api integration with AwapiLasso HTTP, OAuth2 & GraphQL engines', () => {
  let sampleApi: SampleApiServerInstance;
  let baseUrl = '';

  beforeAll(async () => {
    sampleApi = createSampleApiServer();
    baseUrl = await sampleApi.start(0, '127.0.0.1');
  });

  afterAll(async () => {
    await sampleApi.stop();
  });

  beforeEach(() => {
    sampleApi.reset();
    clearAllMemoryOAuth2Tokens();
  });

  it('serves health checks via GET and HEAD', async () => {
    const getRes = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/v1/health`,
      assertions: [
        { target: 'status', operator: 'equals', expected: 200 },
        { target: 'jsonpath', path: '$.status', operator: 'equals', expected: 'ok' },
        { target: 'jsonpath', path: '$.counts.orders', operator: 'equals', expected: 3 },
      ],
    });
    expect(getRes.status).toBe(200);
    expect(getRes.assertions.every(a => a.passed)).toBe(true);

    const headRes = await executeHttpRequest({
      method: 'HEAD',
      url: `${baseUrl}/v1/health`,
    });
    expect(headRes.status).toBe(200);
    expect(headRes.headers['x-health-status']).toBe('healthy');
    expect(headRes.body).toBe('');
  });

  it('supports all RESTful HTTP verbs (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS) on /v1/orders', async () => {
    // 1. OPTIONS preflight
    const optionsRes = await executeHttpRequest({
      method: 'OPTIONS',
      url: `${baseUrl}/v1/orders`,
    });
    expect(optionsRes.status).toBe(204);
    expect(optionsRes.headers.allow).toContain('DELETE');

    // 2. HEAD count
    const headRes = await executeHttpRequest({
      method: 'HEAD',
      url: `${baseUrl}/v1/orders`,
    });
    expect(headRes.status).toBe(200);
    expect(headRes.headers['x-total-count']).toBe('3');

    // 3. GET list with query filter
    const listRes = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/v1/orders`,
      queryParams: [{ key: 'status', value: 'pending', enabled: true }],
    });
    expect(listRes.status).toBe(200);
    const listJson = JSON.parse(listRes.body);
    expect(listJson.data).toHaveLength(1);
    expect(listJson.data[0].id).toBe('ord_1001');

    // 4. POST create a new order and capture $.data.id
    const createRes = await executeHttpRequest({
      method: 'POST',
      url: `${baseUrl}/v1/orders`,
      body: {
        mode: 'json',
        content: JSON.stringify({
          customerId: 'cust_integration_99',
          currency: 'USD',
          items: [{ sku: 'SKU-200', quantity: 2 }],
        }),
      },
      captures: [
        {
          variable: 'createdOrderId',
          scope: 'environment',
          source: 'jsonpath',
          expression: '$.data.id',
        },
      ],
    });
    expect(createRes.status).toBe(201);
    const createdId = createRes.captures[0]?.value;
    expect(createdId).toBe('ord_1004');

    // 5. GET created order by :orderId path param
    const getByIdRes = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/v1/orders/:orderId`,
      pathParams: [{ key: 'orderId', value: createdId! }],
    });
    expect(getByIdRes.status).toBe(200);
    expect(JSON.parse(getByIdRes.body).data.totalAmount).toBe(1098);

    // 6. PUT full replacement
    const putRes = await executeHttpRequest({
      method: 'PUT',
      url: `${baseUrl}/v1/orders/:orderId`,
      pathParams: [{ key: 'orderId', value: createdId! }],
      body: {
        mode: 'json',
        content: JSON.stringify({
          customerId: 'cust_integration_99',
          status: 'processing',
          currency: 'USD',
          notes: 'Replaced via PUT',
          items: [{ sku: 'SKU-100', quantity: 1 }],
        }),
      },
    });
    expect(putRes.status).toBe(200);
    const putData = JSON.parse(putRes.body).data;
    expect(putData.status).toBe('processing');
    expect(putData.notes).toBe('Replaced via PUT');
    expect(putData.totalAmount).toBe(129.99);

    // 7. PATCH partial status update (both JSON and form-urlencoded supported)
    const patchRes = await executeHttpRequest({
      method: 'PATCH',
      url: `${baseUrl}/v1/orders/:orderId`,
      pathParams: [{ key: 'orderId', value: createdId! }],
      body: {
        mode: 'form-urlencoded',
        urlEncoded: [
          { key: 'status', value: 'shipped', enabled: true },
          { key: 'notes', value: 'Updated via form-urlencoded PATCH', enabled: true },
        ],
      },
    });
    expect(patchRes.status).toBe(200);
    const patchData = JSON.parse(patchRes.body).data;
    expect(patchData.status).toBe('shipped');
    expect(patchData.notes).toBe('Updated via form-urlencoded PATCH');

    // 8. DELETE order and confirm 404 afterwards
    const delRes = await executeHttpRequest({
      method: 'DELETE',
      url: `${baseUrl}/v1/orders/:orderId`,
      pathParams: [{ key: 'orderId', value: createdId! }],
    });
    expect(delRes.status).toBe(200);
    expect(JSON.parse(delRes.body).deleted).toBe(true);

    const afterDelRes = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/v1/orders/:orderId`,
      pathParams: [{ key: 'orderId', value: createdId! }],
    });
    expect(afterDelRes.status).toBe(404);
  });

  it('handles multipart-form file upload on /v1/orders/:orderId/attachments', async () => {
    const invoicePath = path.resolve(__dirname, '../samples/invoice.pdf');
    const uploadRes = await executeHttpRequest({
      method: 'POST',
      url: `${baseUrl}/v1/orders/:orderId/attachments`,
      pathParams: [{ key: 'orderId', value: 'ord_1001' }],
      body: {
        mode: 'multipart-form',
        formData: [
          { key: 'documentType', type: 'text', value: 'invoice', enabled: true },
          { key: 'file', type: 'file', filePath: invoicePath, enabled: true },
        ],
      },
    });
    expect(uploadRes.status).toBe(201);
    const attachment = JSON.parse(uploadRes.body).data;
    expect(attachment).toMatchObject({
      orderId: 'ord_1001',
      documentType: 'invoice',
      fileName: 'invoice.pdf',
      contentType: 'application/pdf',
    });
    expect(attachment.sizeBytes).toBeGreaterThan(50);
  });

  it('executes OAuth 2.0 (client_credentials & password) and Basic, API Key, Digest, and Bearer auth flows', async () => {
    const oauthResult = await acquireOAuth2Token({
      config: {
        grantType: 'client_credentials',
        accessTokenUrl: `${baseUrl}/oauth/token`,
        clientId: 'test-svc-client',
        clientSecret: 'test-svc-secret',
        scope: 'orders:read inventory:write',
        clientAuthMethod: 'basic_header',
      },
    });
    expect(oauthResult.ok).toBe(true);
    expect(oauthResult.token?.accessToken.split('.')).toHaveLength(3);
    expect(oauthResult.token?.decodedJwt?.payload?.client_id).toBe('test-svc-client');

    // Bearer endpoint using acquired token
    const bearerRes = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/v1/auth/bearer`,
      auth: {
        type: 'bearer',
        bearer: { token: oauthResult.token!.accessToken },
      },
    });
    expect(bearerRes.status).toBe(200);
    expect(JSON.parse(bearerRes.body).authenticated).toBe(true);

    // Basic auth endpoint
    const basicRes = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/v1/auth/basic`,
      auth: {
        type: 'basic',
        basic: { username: 'alice', password: 'secret' },
      },
    });
    expect(basicRes.status).toBe(200);
    expect(JSON.parse(basicRes.body).user).toBe('alice');

    // API Key auth endpoint
    const apiKeyRes = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/v1/auth/apikey`,
      auth: {
        type: 'apikey',
        apikey: { key: 'X-API-Key', value: 'awapi_live_key_12345', in: 'header' },
      },
    });
    expect(apiKeyRes.status).toBe(200);
    expect(JSON.parse(apiKeyRes.body).location).toBe('header');

    // Digest challenge-response endpoint
    const digestRes = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/v1/auth/digest`,
      auth: {
        type: 'digest',
        digest: { username: 'digest-admin', password: 'digest-password' },
      },
    });
    expect(digestRes.status).toBe(200);
    expect(JSON.parse(digestRes.body).authenticated).toBe(true);
  });

  it('executes GraphQL Introspection, Queries, Union fragments, and Mutations against /graphql', async () => {
    // 1. Live GraphQL IntrospectionQuery
    const introspectRes = await executeHttpRequest({
      protocol: 'graphql',
      method: 'POST',
      url: `${baseUrl}/graphql`,
      graphql: {
        operationName: 'IntrospectionQuery',
        query: getIntrospectionQuery(),
      },
    });
    expect(introspectRes.status).toBe(200);
    const introspectBody = JSON.parse(introspectRes.body);
    expect(introspectBody.errors).toBeUndefined();
    expect(introspectBody.data.__schema.queryType.name).toBe('Query');
    expect(introspectBody.data.__schema.mutationType.name).toBe('Mutation');

    // 2. Query inventoryItem with nested warehouse
    const stockRes = await executeHttpRequest({
      protocol: 'graphql',
      method: 'POST',
      url: `${baseUrl}/graphql`,
      graphql: {
        operationName: 'GetWarehouseStock',
        query: `
          query GetWarehouseStock($sku: ID!, $warehouseId: ID) {
            inventoryItem(sku: $sku, warehouseId: $warehouseId) {
              sku
              name
              availableQuantity
              reservedQuantity
              warehouse {
                id
                name
                region
              }
            }
          }
        `,
        variables: JSON.stringify({ sku: 'SKU-100', warehouseId: 'WH-EAST-01' }),
      },
    });
    expect(stockRes.status).toBe(200);
    const stockData = JSON.parse(stockRes.body).data.inventoryItem;
    expect(stockData).toMatchObject({
      sku: 'SKU-100',
      availableQuantity: 140,
      reservedQuantity: 12,
      warehouse: {
        id: 'WH-EAST-01',
        region: 'us-east-1',
      },
    });

    // 3. Mutation adjustInventoryStock
    const mutateRes = await executeHttpRequest({
      protocol: 'graphql',
      method: 'POST',
      url: `${baseUrl}/graphql`,
      graphql: {
        operationName: 'AdjustStock',
        query: `
          mutation AdjustStock($input: AdjustStockInput!) {
            adjustInventoryStock(input: $input) {
              sku
              availableQuantity
              reservedQuantity
            }
          }
        `,
        variables: JSON.stringify({
          input: { sku: 'SKU-100', deltaAvailable: -15, deltaReserved: 5 },
        }),
      },
    });
    expect(mutateRes.status).toBe(200);
    const mutatedItem = JSON.parse(mutateRes.body).data.adjustInventoryStock;
    expect(mutatedItem).toEqual({
      sku: 'SKU-100',
      availableQuantity: 125,
      reservedQuantity: 17,
    });

    // 4. Union searchCatalog with inline fragments
    const searchRes = await executeHttpRequest({
      protocol: 'graphql',
      method: 'POST',
      url: `${baseUrl}/graphql`,
      graphql: {
        operationName: 'SearchCatalog',
        query: `
          query SearchCatalog($text: String!) {
            searchCatalog(text: $text) {
              __typename
              ... on InventoryItem {
                sku
                name
              }
              ... on Warehouse {
                id
                region
              }
            }
          }
        `,
        variables: JSON.stringify({ text: 'East' }),
      },
    });
    expect(searchRes.status).toBe(200);
    const searchHits = JSON.parse(searchRes.body).data.searchCatalog;
    expect(searchHits).toContainEqual({
      __typename: 'Warehouse',
      id: 'WH-EAST-01',
      region: 'us-east-1',
    });
  });

  it('runs every request in samples/orders-and-inventory.awjc end-to-end against sample-api with 100% passing assertions', async () => {
    const rawCollection = fs.readFileSync(
      path.resolve(__dirname, '../samples/orders-and-inventory.awjc'),
      'utf-8',
    );
    const { collection } = parseCollectionFile(rawCollection);

    const localEnv = collection.environments?.find(e => e.name === 'local');
    expect(localEnv).toBeDefined();

    // Override baseUrl & authBaseUrl to point at the ephemeral test server port, and hydrate mock secrets
    const envVariables: VariableEntry[] = (localEnv?.variables ?? []).map(v => {
      if (v.key === 'baseUrl' || v.key === 'authBaseUrl') {
        return { ...v, value: baseUrl };
      }
      if (v.key === 'clientSecret') {
        return { ...v, value: 'local-dev-secret' };
      }
      if (v.key === 'apiPassword') {
        return { ...v, value: 'local-admin-pass' };
      }
      return { ...v };
    });

    const capturedVariables: VariableEntry[] = [];
    const repoRoot = path.resolve(__dirname, '..');

    const flattenRequests = (
      items: typeof collection.items,
      ancestorFolders: FolderItem[] = [],
    ): Array<{ req: RequestItem; folders: FolderItem[] }> => {
      const out: Array<{ req: RequestItem; folders: FolderItem[] }> = [];
      for (const item of items) {
        if (item.kind === 'request') {
          out.push({ req: item, folders: ancestorFolders });
        } else {
          out.push(...flattenRequests(item.items, [...ancestorFolders, item]));
        }
      }
      return out;
    };

    const allRequests = flattenRequests(collection.items);
    expect(allRequests.length).toBeGreaterThanOrEqual(13);

    for (const { req, folders } of allRequests) {
      const inheritedHeaders = [
        ...(collection.defaults?.headers ?? []),
        ...folders.flatMap(f => f.headers ?? []),
      ];

      // Resolve relative multipart file paths against repo root
      const normalizedBody = req.body
        ? {
            ...req.body,
            formData: req.body.formData?.map(entry =>
              entry.type === 'file' && entry.filePath
                ? { ...entry, filePath: path.resolve(repoRoot, entry.filePath) }
                : entry,
            ),
          }
        : undefined;

      const response = await executeHttpRequest({
        protocol: req.protocol,
        method: req.method,
        url: req.url,
        queryParams: req.queryParams,
        pathParams: req.pathParams,
        inheritedHeaders,
        headers: req.headers,
        body: normalizedBody,
        graphql: req.graphql,
        auth: req.auth,
        ancestorAuthChain: folders.map(f => f.auth),
        collectionDefaultAuth: collection.defaults?.auth,
        authProfiles: collection.authProfiles,
        collectionId: collection.metadata.id,
        environmentId: localEnv?.id,
        authOwnerId: req.id,
        interpolationContext: {
          collectionVariables: collection.variables,
          environmentVariables: envVariables,
          folderVariablesChain: folders.map(f => f.variables ?? []),
          capturedVariables,
        },
        captures: req.captures,
        assertions: req.assertions,
      });

      expect(response.ok, `Request "${req.name}" failed: ${response.error}`).toBe(true);

      // Apply any captured variables for subsequent requests in the sequence
      for (const cap of response.captures) {
        if (cap.matched && cap.value !== null) {
          const existingIdx = capturedVariables.findIndex(v => v.key === cap.variable);
          const entry: VariableEntry = {
            key: cap.variable,
            value: cap.value,
            enabled: true,
          };
          if (existingIdx >= 0) {
            capturedVariables[existingIdx] = entry;
          } else {
            capturedVariables.push(entry);
          }
        }
      }

      for (const assertion of response.assertions) {
        expect(
          assertion.passed,
          `Assertion failed in "${req.name}": ${assertion.message}`,
        ).toBe(true);
      }
    }
  });
});
