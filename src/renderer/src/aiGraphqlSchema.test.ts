import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSchemaFromSdl } from '../../shared/graphqlSchemaLoader';
import {
  getGraphqlSchemaForAi,
  loadGraphqlSchemaForAi,
  publishGraphqlSchemaForAi,
  publishGraphqlSchemaLoaderForAi,
} from './aiGraphqlSchema';

describe('aiGraphqlSchema registry', () => {
  afterEach(() => {
    publishGraphqlSchemaForAi(null);
    publishGraphqlSchemaLoaderForAi(null);
  });

  it('runs the published loader, publishing a loaded schema; null without a GraphQL workspace', async () => {
    expect(await loadGraphqlSchemaForAi()).toBeNull();
    const bundle = loadSchemaFromSdl('type Query { b: Int }');
    const schema = { introspection: bundle.introspection, metadata: bundle.metadata };
    publishGraphqlSchemaLoaderForAi(vi.fn().mockResolvedValueOnce({ ok: false, error: 'down' }).mockResolvedValueOnce({ ok: true, schema }));
    expect(await loadGraphqlSchemaForAi()).toEqual({ ok: false, error: 'down' });
    expect(getGraphqlSchemaForAi()).toBeNull();
    expect(await loadGraphqlSchemaForAi()).toEqual({ ok: true, schema });
    expect(getGraphqlSchemaForAi()).toBe(schema);
  });

  it('holds the most recently published schema and can be cleared', () => {
    expect(getGraphqlSchemaForAi()).toBeNull();
    const bundle = loadSchemaFromSdl('type Query { a: Int }');
    publishGraphqlSchemaForAi({ introspection: bundle.introspection, metadata: bundle.metadata });
    expect(getGraphqlSchemaForAi()?.metadata.queryTypeName).toBe('Query');
    publishGraphqlSchemaForAi(null);
    expect(getGraphqlSchemaForAi()).toBeNull();
  });
});
