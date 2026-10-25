import * as fs from 'fs';
import * as path from 'path';
import { getIntrospectionQuery, type IntrospectionQuery } from 'graphql';
import {
  diffSchemaMetadata,
  loadGraphQLSchemaAuto,
  loadSchemaFromIntrospection,
  type GraphQLSchemaDiffSummary,
  type NormalizedGraphQLSchemaMetadata,
} from '../shared/graphqlSchemaLoader';
import type { HttpResponseResult, PreparedHttpRequest } from '../shared/httpTypes';
import { interpolateText } from '../shared/interpolation';
import { buildResolvedRequestUrl } from '../shared/urlParams';
import { executeHttpRequest, type HttpEngineDeps } from './httpEngine';

export interface GraphQLSchemaCacheCoordinate {
  collectionId?: string;
  environmentId?: string;
  endpointUrl: string;
}

export interface GraphQLCachedSchemaRecord {
  coordinateKey: string;
  collectionId: string;
  environmentId: string;
  endpointUrl: string;
  fetchedAt: string;
  sourceFormat: 'introspection_json' | 'sdl';
  sourceLabel: string;
  introspection: IntrospectionQuery;
  metadata: NormalizedGraphQLSchemaMetadata;
  diffSummary: GraphQLSchemaDiffSummary;
}

export interface GraphQLIntrospectRequest {
  /** Prepared request carrying `url`, `auth`, `headers`, `inheritedHeaders`, `interpolationContext`, etc. */
  request: PreparedHttpRequest;
}

export interface GraphQLLoadLocalSchemaRequest {
  filePath: string;
  collectionFilePath?: string;
  collectionId?: string;
  environmentId?: string;
  endpointUrl?: string;
}

export interface GraphQLSchemaDiscoveryResult {
  ok: boolean;
  error?: string;
  statusCode?: number;
  record?: GraphQLCachedSchemaRecord;
}

export interface GraphQLIntrospectionServiceDeps {
  httpDeps?: HttpEngineDeps;
  sendHttp?: (
    req: PreparedHttpRequest,
    deps?: HttpEngineDeps,
  ) => Promise<HttpResponseResult>;
  readFile?: (filePath: string) => string;
  exists?: (filePath: string) => boolean;
  nowIso?: () => string;
}

const schemaCacheStore = new Map<string, GraphQLCachedSchemaRecord>();

export function buildSchemaCacheCoordinateKey(
  coord: GraphQLSchemaCacheCoordinate,
): string {
  const col = (coord.collectionId || 'default_col').trim();
  const env = (coord.environmentId || 'default_env').trim();
  const url = (coord.endpointUrl || '').trim();
  return `${col}::${env}::${url}`;
}

export function getCachedGraphQLSchema(
  coord: GraphQLSchemaCacheCoordinate,
): GraphQLCachedSchemaRecord | null {
  const key = buildSchemaCacheCoordinateKey(coord);
  return schemaCacheStore.get(key) ?? null;
}

export function clearGraphQLSchemaCache(): void {
  schemaCacheStore.clear();
}

function resolveEndpointUrlFromRequest(request: PreparedHttpRequest): string {
  const ctx = request.interpolationContext ?? {};
  return buildResolvedRequestUrl({
    rawUrl: request.url ?? '',
    queryParams: request.queryParams,
    pathParams: request.pathParams ?? [],
    context: ctx,
  });
}

/**
 * Executes a live `getIntrospectionQuery()` call through the Main-process `httpEngine`
 * so the request inherits resolved `{{variables}}`, `Auth` (including OAuth 2.0),
 * `Headers`, and TLS/timeout settings.
 */
export async function introspectRemoteGraphQLSchema(
  payload: GraphQLIntrospectRequest,
  deps: GraphQLIntrospectionServiceDeps = {},
): Promise<GraphQLSchemaDiscoveryResult> {
  const { request } = payload;
  const resolvedEndpoint = resolveEndpointUrlFromRequest(request);
  if (!resolvedEndpoint || !resolvedEndpoint.trim()) {
    return {
      ok: false,
      error: 'GraphQL endpoint URL is empty. Enter a valid URL before introspecting.',
    };
  }

  const sendFn = deps.sendHttp ?? executeHttpRequest;
  const introspectionQueryString = getIntrospectionQuery();

  const introspectionHttpRequest: PreparedHttpRequest = {
    ...request,
    protocol: 'graphql',
    method: 'POST',
    graphql: {
      operationName: 'IntrospectionQuery',
      query: introspectionQueryString,
      variables: '{}',
    },
    captures: [],
    assertions: [],
  };

  try {
    const response = await sendFn(introspectionHttpRequest, deps.httpDeps);
    if (!response.ok && response.error) {
      return {
        ok: false,
        statusCode: response.status,
        error: `Introspection network error: ${response.error}`,
      };
    }

    if (response.status < 200 || response.status >= 300) {
      return {
        ok: false,
        statusCode: response.status,
        error: `Introspection request failed with HTTP ${response.status} ${response.statusText || ''}`.trim(),
      };
    }

    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(response.body) as Record<string, unknown>;
    } catch {
      return {
        ok: false,
        statusCode: response.status,
        error: 'Endpoint did not return valid JSON for GraphQL IntrospectionQuery.',
      };
    }

    if (Array.isArray(parsedBody.errors) && parsedBody.errors.length > 0 && !parsedBody.data) {
      const firstErr = parsedBody.errors[0] as { message?: string } | undefined;
      return {
        ok: false,
        statusCode: response.status,
        error: `GraphQL introspection error: ${firstErr?.message || 'Introspection disabled or rejected by server.'}`,
      };
    }

    const bundle = loadSchemaFromIntrospection(parsedBody);
    const coord: GraphQLSchemaCacheCoordinate = {
      collectionId: request.collectionId,
      environmentId: request.environmentId,
      endpointUrl: resolvedEndpoint,
    };
    const coordinateKey = buildSchemaCacheCoordinateKey(coord);
    const previousRecord = schemaCacheStore.get(coordinateKey);
    const diffSummary = diffSchemaMetadata(previousRecord?.metadata, bundle.metadata);

    const record: GraphQLCachedSchemaRecord = {
      coordinateKey,
      collectionId: coord.collectionId || 'default_col',
      environmentId: coord.environmentId || 'default_env',
      endpointUrl: resolvedEndpoint,
      fetchedAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
      sourceFormat: bundle.sourceFormat,
      sourceLabel: resolvedEndpoint,
      introspection: bundle.introspection,
      metadata: bundle.metadata,
      diffSummary,
    };

    schemaCacheStore.set(coordinateKey, record);
    return {
      ok: true,
      statusCode: response.status,
      record,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Loads an offline `.graphql` / `.gql` SDL file or `.json` IntrospectionQuery file from disk
 * and stores it in the per-environment schema cache.
 */
export function loadLocalGraphQLSchemaFile(
  req: GraphQLLoadLocalSchemaRequest,
  deps: GraphQLIntrospectionServiceDeps = {},
): GraphQLSchemaDiscoveryResult {
  const rawPath = (req.filePath || '').trim();
  if (!rawPath) {
    return {
      ok: false,
      error: 'Local schema file path is empty.',
    };
  }

  const readFile = deps.readFile ?? ((p: string) => fs.readFileSync(p, 'utf-8'));
  const exists = deps.exists ?? ((p: string) => fs.existsSync(p));

  const candidatePaths: string[] = [];
  if (path.isAbsolute(rawPath)) {
    candidatePaths.push(rawPath);
  } else {
    if (req.collectionFilePath) {
      candidatePaths.push(path.resolve(path.dirname(req.collectionFilePath), rawPath));
    }
    candidatePaths.push(path.resolve(process.cwd(), rawPath));
  }

  const resolvedFile = candidatePaths.find(p => exists(p)) ?? candidatePaths[0];
  if (!exists(resolvedFile)) {
    return {
      ok: false,
      error: `Local schema file not found: ${resolvedFile}`,
    };
  }

  try {
    const content = readFile(resolvedFile);
    const bundle = loadGraphQLSchemaAuto(content, resolvedFile);

    const endpointKey = (req.endpointUrl || resolvedFile).trim();
    const coord: GraphQLSchemaCacheCoordinate = {
      collectionId: req.collectionId,
      environmentId: req.environmentId,
      endpointUrl: endpointKey,
    };
    const coordinateKey = buildSchemaCacheCoordinateKey(coord);
    const previousRecord = schemaCacheStore.get(coordinateKey);
    const diffSummary = diffSchemaMetadata(previousRecord?.metadata, bundle.metadata);

    const record: GraphQLCachedSchemaRecord = {
      coordinateKey,
      collectionId: coord.collectionId || 'default_col',
      environmentId: coord.environmentId || 'default_env',
      endpointUrl: endpointKey,
      fetchedAt: (deps.nowIso ?? (() => new Date().toISOString()))(),
      sourceFormat: bundle.sourceFormat,
      sourceLabel: path.basename(resolvedFile),
      introspection: bundle.introspection,
      metadata: bundle.metadata,
      diffSummary,
    };

    schemaCacheStore.set(coordinateKey, record);
    return {
      ok: true,
      record,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to parse local GraphQL schema "${path.basename(resolvedFile)}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
