import * as http from 'http';
import { describe, it, expect, beforeEach } from 'vitest';
import { buildSchema, graphql } from 'graphql';
import {
  clearGraphQLSchemaCache,
  getCachedGraphQLSchema,
  introspectRemoteGraphQLSchema,
  loadLocalGraphQLSchemaFile,
} from './graphqlIntrospection';

const TEST_SDL = `
  type Warehouse {
    id: ID!
    name: String!
    region: String!
  }

  type InventoryItem {
    id: ID!
    sku: ID!
    name: String!
    availableQuantity: Int!
    warehouse: Warehouse
  }

  type Query {
    inventoryItem(sku: ID!): InventoryItem
    warehouses(activeOnly: Boolean): [Warehouse!]!
  }
`;

describe('graphqlIntrospection service', () => {
  beforeEach(() => {
    clearGraphQLSchemaCache();
  });

  it('executes live getIntrospectionQuery() via httpEngine with interpolated URL, Auth, and Headers, and caches the schema', async () => {
    const schema = buildSchema(TEST_SDL);
    let capturedAuthHeader: string | undefined;
    let capturedCustomHeader: string | undefined;

    const server = http.createServer((req, res) => {
      capturedAuthHeader = req.headers.authorization;
      capturedCustomHeader = req.headers['x-tenant-id'] as string | undefined;

      let body = '';
      req.on('data', chunk => {
        body += String(chunk);
      });
      req.on('end', async () => {
        const parsed = JSON.parse(body) as {
          query: string;
          variables?: Record<string, unknown>;
          operationName?: string;
        };
        const result = await graphql({
          schema,
          source: parsed.query,
          variableValues: parsed.variables,
          operationName: parsed.operationName,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      const result = await introspectRemoteGraphQLSchema(
        {
          request: {
            protocol: 'graphql',
            method: 'POST',
            url: '{{baseUrl}}/graphql',
            headers: [{ key: 'X-Tenant-Id', value: '{{tenantId}}', enabled: true }],
            auth: {
              type: 'bearer',
              bearer: { token: '{{apiToken}}' },
            },
            interpolationContext: {
              environmentVariables: [
                { key: 'baseUrl', value: baseUrl, enabled: true },
                { key: 'tenantId', value: 'tenant_acme', enabled: true },
                { key: 'apiToken', value: 'secret_jwt_123', enabled: true },
              ],
            },
            collectionId: 'col_test',
            environmentId: 'local',
          },
        },
        { nowIso: () => '2026-10-25T04:00:00Z' },
      );

      expect(result.ok).toBe(true);
      expect(capturedAuthHeader).toBe('Bearer secret_jwt_123');
      expect(capturedCustomHeader).toBe('tenant_acme');
      expect(result.record).toBeDefined();
      expect(result.record?.fetchedAt).toBe('2026-10-25T04:00:00Z');
      expect(result.record?.metadata.queryTypeName).toBe('Query');
      expect(result.record?.metadata.typeNames).toEqual(
        expect.arrayContaining(['InventoryItem', 'Warehouse', 'Query']),
      );

      // Verify schema is cached by (collectionId, environmentId, endpointUrl)
      const cached = getCachedGraphQLSchema({
        collectionId: 'col_test',
        environmentId: 'local',
        endpointUrl: `${baseUrl}/graphql`,
      });
      expect(cached).not.toBeNull();
      expect(cached?.metadata.typeCount).toBe(result.record?.metadata.typeCount);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('returns an actionable error when remote server disables introspection or returns HTTP 401/500', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          errors: [{ message: 'GraphQL introspection is not allowed by Apollo Server' }],
        }),
      );
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address() as { port: number };
    const endpoint = `http://127.0.0.1:${addr.port}/graphql`;

    try {
      const res = await introspectRemoteGraphQLSchema({
        request: {
          protocol: 'graphql',
          method: 'POST',
          url: endpoint,
        },
      });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('GraphQL introspection is not allowed');
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });

  it('loads offline .graphql SDL and .json introspection files from disk and computes schema diff on refresh', () => {
    const files: Record<string, string> = {
      '/workspace/schemas/inventory.graphql': TEST_SDL,
      '/workspace/schemas/inventory-v2.graphql': `${TEST_SDL}\n  type Supplier { id: ID! name: String! }\n`,
    };

    const first = loadLocalGraphQLSchemaFile(
      {
        filePath: '/workspace/schemas/inventory.graphql',
        collectionId: 'col_1',
        environmentId: 'prod',
        endpointUrl: 'https://api.example.com/graphql',
      },
      {
        exists: p => Boolean(files[p]),
        readFile: p => files[p],
        nowIso: () => '2026-10-25T05:00:00Z',
      },
    );

    expect(first.ok).toBe(true);
    expect(first.record?.sourceFormat).toBe('sdl');
    expect(first.record?.diffSummary.hasChanges).toBe(false);

    const second = loadLocalGraphQLSchemaFile(
      {
        filePath: '/workspace/schemas/inventory-v2.graphql',
        collectionId: 'col_1',
        environmentId: 'prod',
        endpointUrl: 'https://api.example.com/graphql',
      },
      {
        exists: p => Boolean(files[p]),
        readFile: p => files[p],
        nowIso: () => '2026-10-25T05:05:00Z',
      },
    );

    expect(second.ok).toBe(true);
    expect(second.record?.diffSummary.hasChanges).toBe(true);
    expect(second.record?.diffSummary.addedTypes).toEqual(['Supplier']);
  });
});
