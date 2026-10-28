import type { IntrospectionQuery } from 'graphql';
import type { NormalizedGraphQLSchemaMetadata } from '../../shared/graphqlSchemaLoader';

export interface AiGraphqlSchema {
  introspection: IntrospectionQuery;
  metadata: NormalizedGraphQLSchemaMetadata;
}

/**
 * Single-slot registry for the schema loaded by the GraphQL workspace of the active request.
 * Only one GraphQL workspace is mounted at a time, so the assistant's schema tools read this slot.
 */
let current: AiGraphqlSchema | null = null;

export function publishGraphqlSchemaForAi(schema: AiGraphqlSchema | null): void {
  current = schema;
}

export function getGraphqlSchemaForAi(): AiGraphqlSchema | null {
  return current;
}
