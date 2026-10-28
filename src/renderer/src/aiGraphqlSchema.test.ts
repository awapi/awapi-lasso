import { afterEach, describe, expect, it } from 'vitest';
import { loadSchemaFromSdl } from '../../shared/graphqlSchemaLoader';
import { getGraphqlSchemaForAi, publishGraphqlSchemaForAi } from './aiGraphqlSchema';

describe('aiGraphqlSchema registry', () => {
  afterEach(() => publishGraphqlSchemaForAi(null));

  it('holds the most recently published schema and can be cleared', () => {
    expect(getGraphqlSchemaForAi()).toBeNull();
    const bundle = loadSchemaFromSdl('type Query { a: Int }');
    publishGraphqlSchemaForAi({ introspection: bundle.introspection, metadata: bundle.metadata });
    expect(getGraphqlSchemaForAi()?.metadata.queryTypeName).toBe('Query');
    publishGraphqlSchemaForAi(null);
    expect(getGraphqlSchemaForAi()).toBeNull();
  });
});
