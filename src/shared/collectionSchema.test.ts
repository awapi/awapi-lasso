import { describe, it, expect } from 'vitest';
import {
  AWJC_SCHEMA_VERSION,
  createEmptyCollection,
  createDefaultHttpRequest,
  createDefaultGraphQLRequest,
  createDefaultFolder,
  createDefaultEnvironment,
  validateAwjcCollection,
} from './collectionSchema';

describe('collectionSchema', () => {
  it('creates a valid empty collection with defaults and local environment', () => {
    const col = createEmptyCollection('Orders API');
    expect(col.awapiLasso).toBe(AWJC_SCHEMA_VERSION);
    expect(col.kind).toBe('Collection');
    expect(col.metadata.name).toBe('Orders API');
    expect(col.metadata.id).toMatch(/^col_/);
    expect(col.activeEnvironment).toBe('local');
    expect(col.environments).toHaveLength(1);
    expect(col.environments?.[0].name).toBe('local');

    const validation = validateAwjcCollection(col);
    expect(validation).toEqual({ valid: true, errors: [] });
  });

  it('creates default HTTP, GraphQL, Folder, and Environment items', () => {
    const httpReq = createDefaultHttpRequest({ name: 'List Users', method: 'GET' });
    expect(httpReq.kind).toBe('request');
    expect(httpReq.protocol).toBe('http');
    expect(httpReq.method).toBe('GET');
    expect(httpReq.auth?.type).toBe('inherit');

    const gqlReq = createDefaultGraphQLRequest({ name: 'Query Users' });
    expect(gqlReq.kind).toBe('request');
    expect(gqlReq.protocol).toBe('graphql');
    expect(gqlReq.graphql?.schemaSource?.mode).toBe('introspect');

    const folder = createDefaultFolder('Users Folder', [httpReq, gqlReq]);
    expect(folder.kind).toBe('folder');
    expect(folder.items).toHaveLength(2);

    const env = createDefaultEnvironment('staging', '#f59e0b');
    expect(env.name).toBe('staging');
    expect(env.color).toBe('#f59e0b');

    const col = createEmptyCollection('Full Collection', {
      environments: [env],
      items: [folder],
    });
    expect(validateAwjcCollection(col)).toEqual({ valid: true, errors: [] });
  });

  it('reports clear validation errors for malformed collection documents', () => {
    expect(validateAwjcCollection(null).valid).toBe(false);
    expect(validateAwjcCollection({}).errors).toEqual([
      'Missing or invalid "awapiLasso" schema version string',
      'Field "kind" must equal "Collection"',
      'Field "metadata" is required and must be an object',
      'Field "items" is required and must be an array',
    ]);

    const invalidNested = {
      awapiLasso: '1.0',
      kind: 'Collection',
      metadata: { id: 'col_1', name: 'Bad Items' },
      items: [
        {
          kind: 'folder',
          id: 'fld_1',
          name: 'Orders',
          items: [{ kind: 'request', id: '', name: '', protocol: 'invalid', method: '', url: 123 }],
        },
      ],
    };

    const res = validateAwjcCollection(invalidNested);
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('items[0].items[0]: request.id is required');
    expect(res.errors).toContain("items[0].items[0]: request.protocol must be 'http' or 'graphql'");
  });
});
