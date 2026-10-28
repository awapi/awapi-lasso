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

export type AiGraphqlSchemaLoadResult = { ok: true; schema: AiGraphqlSchema } | { ok: false; error: string };

/** Discovers the schema the same way as the GraphQL tab's Discover button (introspection, then local file). */
let loader: (() => Promise<AiGraphqlSchemaLoadResult>) | null = null;

export function publishGraphqlSchemaLoaderForAi(next: (() => Promise<AiGraphqlSchemaLoadResult>) | null): void {
  loader = next;
}

/** Runs the active GraphQL workspace's loader. Resolves null when no GraphQL request is open. */
export async function loadGraphqlSchemaForAi(): Promise<AiGraphqlSchemaLoadResult | null> {
  if (!loader) return null;
  const result = await loader();
  if (result.ok) current = result.schema;
  return result;
}
