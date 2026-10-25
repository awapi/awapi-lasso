import * as yaml from 'yaml';
import {
  AWJC_SCHEMA_VERSION,
  createDefaultFolder,
  createDefaultHttpRequest,
  generateAwjcId,
  type AuthConfig,
  type AuthProfile,
  type AwjcCollection,
  type CollectionTreeItem,
  type EnvironmentConfig,
  type FolderItem,
  type FormDataEntry,
  type KeyValueEntry,
  type OAuth2Config,
  type PathParamEntry,
  type QueryParamEntry,
  type RequestBodyConfig,
  type RequestItem,
  type VariableEntry,
} from './collectionSchema';
import { syncUrlFromQueryParams } from './urlParams';

type AnyRecord = Record<string, unknown>;

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
] as const;

function isObject(val: unknown): val is AnyRecord {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

/**
 * Resolves a local JSON Pointer `$ref` (e.g. `#/components/schemas/Order` or `#/definitions/Order`)
 * against the root OpenAPI/Swagger document.
 */
function resolveRef(root: AnyRecord, node: unknown, visited = new Set<string>()): unknown {
  if (!isObject(node)) return node;
  const ref = node.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    return node;
  }
  if (visited.has(ref)) {
    return {};
  }
  visited.add(ref);

  const segments = ref
    .slice(2)
    .split('/')
    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));

  let current: unknown = root;
  for (const seg of segments) {
    if (!isObject(current)) return {};
    current = current[seg];
  }

  return resolveRef(root, current, visited);
}

/**
 * Generates a deterministic sample JSON value from an OpenAPI / JSON Schema definition.
 */
export function generateSampleFromSchema(
  root: AnyRecord,
  rawSchema: unknown,
  visited = new Set<string>(),
  depth = 0,
): unknown {
  if (depth > 6 || !rawSchema) return null;

  if (isObject(rawSchema) && typeof rawSchema.$ref === 'string') {
    const refStr = rawSchema.$ref;
    if (visited.has(refStr)) return {};
    const nextVisited = new Set(visited);
    nextVisited.add(refStr);
    const resolved = resolveRef(root, rawSchema, new Set());
    return generateSampleFromSchema(root, resolved, nextVisited, depth + 1);
  }

  if (!isObject(rawSchema)) return null;

  if (rawSchema.example !== undefined) {
    return rawSchema.example;
  }
  if (rawSchema.default !== undefined) {
    return rawSchema.default;
  }
  if (Array.isArray(rawSchema.enum) && rawSchema.enum.length > 0) {
    return rawSchema.enum[0];
  }

  if (Array.isArray(rawSchema.allOf) && rawSchema.allOf.length > 0) {
    const merged: AnyRecord = {};
    for (const sub of rawSchema.allOf) {
      const sample = generateSampleFromSchema(root, sub, visited, depth + 1);
      if (isObject(sample)) {
        Object.assign(merged, sample);
      }
    }
    return merged;
  }

  if (Array.isArray(rawSchema.oneOf) && rawSchema.oneOf.length > 0) {
    return generateSampleFromSchema(root, rawSchema.oneOf[0], visited, depth + 1);
  }
  if (Array.isArray(rawSchema.anyOf) && rawSchema.anyOf.length > 0) {
    return generateSampleFromSchema(root, rawSchema.anyOf[0], visited, depth + 1);
  }

  const schemaType = Array.isArray(rawSchema.type)
    ? rawSchema.type.find(t => t !== 'null')
    : rawSchema.type;

  if (schemaType === 'object' || isObject(rawSchema.properties)) {
    const props = isObject(rawSchema.properties) ? rawSchema.properties : {};
    const obj: AnyRecord = {};
    for (const [propKey, propSchema] of Object.entries(props)) {
      obj[propKey] = generateSampleFromSchema(root, propSchema, visited, depth + 1);
    }
    return obj;
  }

  if (schemaType === 'array') {
    const itemSample = generateSampleFromSchema(
      root,
      rawSchema.items ?? { type: 'string' },
      visited,
      depth + 1,
    );
    return [itemSample];
  }

  if (schemaType === 'integer' || schemaType === 'number') {
    return typeof rawSchema.minimum === 'number' ? rawSchema.minimum : 1;
  }

  if (schemaType === 'boolean') {
    return true;
  }

  if (schemaType === 'string' || !schemaType) {
    const format = typeof rawSchema.format === 'string' ? rawSchema.format : '';
    switch (format) {
      case 'date-time':
        return '2025-01-01T00:00:00Z';
      case 'date':
        return '2025-01-01';
      case 'email':
        return 'user@example.com';
      case 'uuid':
        return '00000000-0000-4000-8000-000000000001';
      case 'uri':
      case 'url':
        return 'https://example.com';
      default:
        return 'string';
    }
  }

  return null;
}

function extractBaseUrls(doc: AnyRecord): Array<{ name: string; url: string }> {
  // OpenAPI 3.x servers
  if (Array.isArray(doc.servers) && doc.servers.length > 0) {
    const results: Array<{ name: string; url: string }> = [];
    doc.servers.forEach((srv, idx) => {
      if (!isObject(srv) || typeof srv.url !== 'string') return;
      let resolvedUrl = srv.url.trim();
      if (isObject(srv.variables)) {
        for (const [varName, varDef] of Object.entries(srv.variables)) {
          if (isObject(varDef) && varDef.default !== undefined) {
            resolvedUrl = resolvedUrl.replace(
              new RegExp(`\\{${varName}\\}`, 'g'),
              String(varDef.default),
            );
          }
        }
      }
      resolvedUrl = resolvedUrl.replace(/\/+$/, '');
      const envName =
        typeof srv.description === 'string' && srv.description.trim()
          ? srv.description.trim()
          : idx === 0
            ? 'default'
            : `server-${idx + 1}`;
      results.push({ name: envName, url: resolvedUrl || 'http://localhost:8080' });
    });
    if (results.length > 0) return results;
  }

  // Swagger 2.0 host + basePath + schemes
  if (typeof doc.swagger === 'string' && doc.swagger.startsWith('2.')) {
    const schemes = Array.isArray(doc.schemes) ? doc.schemes : [];
    const scheme =
      schemes.includes('https')
        ? 'https'
        : typeof schemes[0] === 'string'
          ? schemes[0]
          : 'https';
    const host =
      typeof doc.host === 'string' && doc.host.trim() ? doc.host.trim() : 'localhost:8080';
    const basePath =
      typeof doc.basePath === 'string' && doc.basePath.trim() !== '/'
        ? doc.basePath.trim().replace(/\/+$/, '')
        : '';
    return [{ name: 'default', url: `${scheme}://${host}${basePath}` }];
  }

  return [{ name: 'default', url: 'http://localhost:8080' }];
}

function convertSecurityScheme(
  schemeKey: string,
  rawScheme: AnyRecord,
): { authConfig: AuthConfig; profile: AuthProfile } | null {
  const type = typeof rawScheme.type === 'string' ? rawScheme.type.toLowerCase() : '';
  const description =
    typeof rawScheme.description === 'string' ? rawScheme.description : undefined;

  if (type === 'http') {
    const scheme =
      typeof rawScheme.scheme === 'string' ? rawScheme.scheme.toLowerCase() : 'bearer';
    if (scheme === 'basic') {
      const authConfig: AuthConfig = {
        type: 'basic',
        basic: {
          username: '{{basicUsername}}',
          password: '{{basicPassword}}',
        },
      };
      return {
        authConfig,
        profile: {
          id: `auth_${schemeKey}`,
          name: schemeKey,
          ...(description ? { description } : {}),
          ...authConfig,
        },
      };
    }

    const authConfig: AuthConfig = {
      type: 'bearer',
      bearer: {
        token: '{{bearerToken}}',
        prefix: 'Bearer',
      },
    };
    return {
      authConfig,
      profile: {
        id: `auth_${schemeKey}`,
        name: schemeKey,
        ...(description ? { description } : {}),
        ...authConfig,
      },
    };
  }

  if (type === 'basic') {
    const authConfig: AuthConfig = {
      type: 'basic',
      basic: {
        username: '{{basicUsername}}',
        password: '{{basicPassword}}',
      },
    };
    return {
      authConfig,
      profile: {
        id: `auth_${schemeKey}`,
        name: schemeKey,
        ...(description ? { description } : {}),
        ...authConfig,
      },
    };
  }

  if (type === 'apikey') {
    const location = rawScheme.in === 'query' ? 'query' : 'header';
    const keyName =
      typeof rawScheme.name === 'string' && rawScheme.name.trim()
        ? rawScheme.name.trim()
        : 'X-API-Key';
    const authConfig: AuthConfig = {
      type: 'apikey',
      apikey: {
        key: keyName,
        value: '{{apiKey}}',
        in: location,
      },
    };
    return {
      authConfig,
      profile: {
        id: `auth_${schemeKey}`,
        name: schemeKey,
        ...(description ? { description } : {}),
        ...authConfig,
      },
    };
  }

  if (type === 'oauth2') {
    let oauth2: OAuth2Config = {
      grantType: 'client_credentials',
      accessTokenUrl: '{{baseUrl}}/oauth/token',
      clientId: '{{oauthClientId}}',
      clientSecret: '{{oauthClientSecret}}',
    };

    // OpenAPI 3.x flows
    if (isObject(rawScheme.flows)) {
      const flows = rawScheme.flows;
      if (isObject(flows.clientCredentials)) {
        const f = flows.clientCredentials;
        oauth2 = {
          grantType: 'client_credentials',
          accessTokenUrl:
            typeof f.tokenUrl === 'string' ? f.tokenUrl : '{{baseUrl}}/oauth/token',
          clientId: '{{oauthClientId}}',
          clientSecret: '{{oauthClientSecret}}',
          scope: isObject(f.scopes) ? Object.keys(f.scopes).join(' ') : undefined,
        };
      } else if (isObject(flows.authorizationCode)) {
        const f = flows.authorizationCode;
        oauth2 = {
          grantType: 'authorization_code_pkce',
          authorizationUrl:
            typeof f.authorizationUrl === 'string'
              ? f.authorizationUrl
              : '{{baseUrl}}/oauth/authorize',
          accessTokenUrl:
            typeof f.tokenUrl === 'string' ? f.tokenUrl : '{{baseUrl}}/oauth/token',
          clientId: '{{oauthClientId}}',
          clientSecret: '{{oauthClientSecret}}',
          scope: isObject(f.scopes) ? Object.keys(f.scopes).join(' ') : undefined,
        };
      } else if (isObject(flows.password)) {
        const f = flows.password;
        oauth2 = {
          grantType: 'password',
          accessTokenUrl:
            typeof f.tokenUrl === 'string' ? f.tokenUrl : '{{baseUrl}}/oauth/token',
          clientId: '{{oauthClientId}}',
          clientSecret: '{{oauthClientSecret}}',
          username: '{{oauthUsername}}',
          password: '{{oauthPassword}}',
          scope: isObject(f.scopes) ? Object.keys(f.scopes).join(' ') : undefined,
        };
      }
    } else if (typeof rawScheme.flow === 'string') {
      // Swagger 2.0 oauth2
      const flow = rawScheme.flow;
      const tokenUrl =
        typeof rawScheme.tokenUrl === 'string'
          ? rawScheme.tokenUrl
          : '{{baseUrl}}/oauth/token';
      const authUrl =
        typeof rawScheme.authorizationUrl === 'string'
          ? rawScheme.authorizationUrl
          : '{{baseUrl}}/oauth/authorize';
      const scopes = isObject(rawScheme.scopes)
        ? Object.keys(rawScheme.scopes).join(' ')
        : undefined;
      if (flow === 'accessCode' || flow === 'implicit') {
        oauth2 = {
          grantType: 'authorization_code_pkce',
          authorizationUrl: authUrl,
          accessTokenUrl: tokenUrl,
          clientId: '{{oauthClientId}}',
          scope: scopes,
        };
      } else if (flow === 'password') {
        oauth2 = {
          grantType: 'password',
          accessTokenUrl: tokenUrl,
          clientId: '{{oauthClientId}}',
          username: '{{oauthUsername}}',
          password: '{{oauthPassword}}',
          scope: scopes,
        };
      } else {
        oauth2 = {
          grantType: 'client_credentials',
          accessTokenUrl: tokenUrl,
          clientId: '{{oauthClientId}}',
          clientSecret: '{{oauthClientSecret}}',
          scope: scopes,
        };
      }
    }

    const authConfig: AuthConfig = {
      type: 'oauth2',
      oauth2,
    };
    return {
      authConfig,
      profile: {
        id: `auth_${schemeKey}`,
        name: schemeKey,
        ...(description ? { description } : {}),
        ...authConfig,
      },
    };
  }

  return null;
}

function extractParameterSampleValue(root: AnyRecord, param: AnyRecord): string {
  if (param.example !== undefined && param.example !== null) {
    return String(param.example);
  }
  if (param.default !== undefined && param.default !== null) {
    return String(param.default);
  }
  if (isObject(param.schema)) {
    const resolvedSchema = resolveRef(root, param.schema);
    if (isObject(resolvedSchema)) {
      if (resolvedSchema.example !== undefined && resolvedSchema.example !== null) {
        return String(resolvedSchema.example);
      }
      if (resolvedSchema.default !== undefined && resolvedSchema.default !== null) {
        return String(resolvedSchema.default);
      }
      if (Array.isArray(resolvedSchema.enum) && resolvedSchema.enum.length > 0) {
        return String(resolvedSchema.enum[0]);
      }
    }
  }
  return '';
}

function buildRequestBody(
  root: AnyRecord,
  operation: AnyRecord,
  bodyParams: AnyRecord[],
  formParams: AnyRecord[],
  headers: KeyValueEntry[],
): RequestBodyConfig {
  const ensureContentType = (mime: string) => {
    if (!headers.some(h => h.key.toLowerCase() === 'content-type')) {
      headers.push({ key: 'Content-Type', value: mime, enabled: true });
    }
  };

  // OpenAPI 3.x requestBody
  if (isObject(operation.requestBody)) {
    const reqBody = resolveRef(root, operation.requestBody);
    if (isObject(reqBody) && isObject(reqBody.content)) {
      const contentMap = reqBody.content;
      const jsonKey = Object.keys(contentMap).find(k => k.toLowerCase().includes('json'));
      if (jsonKey && isObject(contentMap[jsonKey])) {
        const mediaObj = contentMap[jsonKey] as AnyRecord;
        let samplePayload: unknown = undefined;
        if (mediaObj.example !== undefined) {
          samplePayload = mediaObj.example;
        } else if (isObject(mediaObj.examples)) {
          const firstEx = Object.values(mediaObj.examples)[0];
          const resolvedEx = resolveRef(root, firstEx);
          if (isObject(resolvedEx) && resolvedEx.value !== undefined) {
            samplePayload = resolvedEx.value;
          }
        }
        if (samplePayload === undefined && mediaObj.schema) {
          samplePayload = generateSampleFromSchema(root, mediaObj.schema);
        }
        ensureContentType(jsonKey);
        return {
          mode: 'json',
          content: JSON.stringify(samplePayload ?? {}, null, 2),
        };
      }

      const urlEncodedKey = Object.keys(contentMap).find(k =>
        k.toLowerCase().includes('x-www-form-urlencoded'),
      );
      if (urlEncodedKey && isObject(contentMap[urlEncodedKey])) {
        const mediaObj = contentMap[urlEncodedKey] as AnyRecord;
        const sampleObj = generateSampleFromSchema(root, mediaObj.schema);
        const urlEncoded: KeyValueEntry[] = isObject(sampleObj)
          ? Object.entries(sampleObj).map(([k, v]) => ({
              key: k,
              value: v !== null && v !== undefined ? String(v) : '',
              enabled: true,
            }))
          : [];
        ensureContentType('application/x-www-form-urlencoded');
        return {
          mode: 'form-urlencoded',
          urlEncoded,
        };
      }

      const multipartKey = Object.keys(contentMap).find(k =>
        k.toLowerCase().includes('multipart/form-data'),
      );
      if (multipartKey && isObject(contentMap[multipartKey])) {
        const mediaObj = contentMap[multipartKey] as AnyRecord;
        const schema = resolveRef(root, mediaObj.schema);
        const props = isObject(schema) && isObject(schema.properties) ? schema.properties : {};
        const formData: FormDataEntry[] = Object.entries(props).map(([k, prop]) => {
          const resolvedProp = resolveRef(root, prop);
          const isBinary =
            isObject(resolvedProp) &&
            (resolvedProp.format === 'binary' || resolvedProp.format === 'base64');
          return isBinary
            ? { key: k, type: 'file', filePath: '', enabled: true }
            : {
                key: k,
                type: 'text',
                value: String(generateSampleFromSchema(root, resolvedProp) ?? ''),
                enabled: true,
              };
        });
        return {
          mode: 'multipart-form',
          formData,
        };
      }
    }
  }

  // Swagger 2.0 `in: body` parameter
  if (bodyParams.length > 0) {
    const firstBodyParam = bodyParams[0];
    const sample = generateSampleFromSchema(root, firstBodyParam.schema);
    ensureContentType('application/json');
    return {
      mode: 'json',
      content: JSON.stringify(sample ?? {}, null, 2),
    };
  }

  // Swagger 2.0 `in: formData` parameters
  if (formParams.length > 0) {
    const consumes = Array.isArray(operation.consumes) ? operation.consumes : [];
    const isMultipart =
      consumes.some(c => typeof c === 'string' && c.includes('multipart/form-data')) ||
      formParams.some(p => p.type === 'file');

    if (isMultipart) {
      return {
        mode: 'multipart-form',
        formData: formParams.map(p =>
          p.type === 'file'
            ? {
                key: String(p.name ?? ''),
                type: 'file',
                filePath: '',
                enabled: true,
                description: typeof p.description === 'string' ? p.description : undefined,
              }
            : {
                key: String(p.name ?? ''),
                type: 'text',
                value: extractParameterSampleValue(root, p),
                enabled: true,
                description: typeof p.description === 'string' ? p.description : undefined,
              },
        ),
      };
    }

    return {
      mode: 'form-urlencoded',
      urlEncoded: formParams.map(p => ({
        key: String(p.name ?? ''),
        value: extractParameterSampleValue(root, p),
        enabled: true,
        description: typeof p.description === 'string' ? p.description : undefined,
      })),
    };
  }

  return { mode: 'none' };
}

/**
 * Imports an OpenAPI 3.0 / 3.1 or Swagger 2.0 specification (YAML or JSON string or parsed object)
 * and converts it into an AwapiLasso `AwjcCollection`.
 */
export function importOpenApiSpec(input: string | Record<string, unknown>): AwjcCollection {
  let doc: unknown = input;
  if (typeof input === 'string') {
    doc = yaml.parse(input);
  }

  if (!isObject(doc)) {
    throw new Error('Invalid OpenAPI / Swagger specification: document must be an object');
  }

  const isOpenApi3 = typeof doc.openapi === 'string' && doc.openapi.startsWith('3.');
  const isSwagger2 = typeof doc.swagger === 'string' && doc.swagger.startsWith('2.');
  if (!isOpenApi3 && !isSwagger2) {
    throw new Error(
      'Unsupported specification version: expected OpenAPI 3.x (`openapi: 3.x`) or Swagger 2.0 (`swagger: "2.0"`)',
    );
  }

  const info = isObject(doc.info) ? doc.info : {};
  const title =
    typeof info.title === 'string' && info.title.trim()
      ? info.title.trim()
      : 'Imported OpenAPI Collection';
  const description =
    typeof info.description === 'string' && info.description.trim()
      ? info.description.trim()
      : undefined;
  const version =
    typeof info.version === 'string' && info.version.trim() ? info.version.trim() : '1.0.0';

  const baseUrls = extractBaseUrls(doc);
  const primaryBaseUrl = baseUrls[0]?.url ?? 'http://localhost:8080';

  const environments: EnvironmentConfig[] = baseUrls.map((srv, idx) => ({
    id: generateAwjcId('env'),
    name: srv.name,
    color: idx === 0 ? '#22c55e' : '#3b82f6',
    variables: [{ key: 'baseUrl', value: srv.url, enabled: true }],
  }));

  const collectionVariables: VariableEntry[] = [
    { key: 'baseUrl', value: primaryBaseUrl, enabled: true },
  ];

  // Parse security schemes -> authProfiles + map by scheme name
  const schemeMap = new Map<string, AuthConfig>();
  const authProfiles: AuthProfile[] = [];
  const rawSchemes = isOpenApi3
    ? isObject(doc.components) && isObject(doc.components.securitySchemes)
      ? doc.components.securitySchemes
      : {}
    : isObject(doc.securityDefinitions)
      ? doc.securityDefinitions
      : {};

  for (const [schemeName, rawDef] of Object.entries(rawSchemes)) {
    const resolvedDef = resolveRef(doc, rawDef);
    if (!isObject(resolvedDef)) continue;
    const converted = convertSecurityScheme(schemeName, resolvedDef);
    if (converted) {
      schemeMap.set(schemeName, converted.authConfig);
      authProfiles.push(converted.profile);
    }
  }

  const resolveSecurityArray = (secArray: unknown): AuthConfig | undefined => {
    if (!Array.isArray(secArray)) return undefined;
    if (secArray.length === 0) return { type: 'none' };
    for (const secReq of secArray) {
      if (isObject(secReq)) {
        const firstSchemeName = Object.keys(secReq)[0];
        if (firstSchemeName && schemeMap.has(firstSchemeName)) {
          return schemeMap.get(firstSchemeName);
        }
      }
    }
    return undefined;
  };

  const defaultAuth = resolveSecurityArray(doc.security);

  // Tag descriptions lookup
  const tagDescriptions = new Map<string, string>();
  if (Array.isArray(doc.tags)) {
    for (const t of doc.tags) {
      if (isObject(t) && typeof t.name === 'string' && typeof t.description === 'string') {
        tagDescriptions.set(t.name, t.description);
      }
    }
  }

  const foldersByTag = new Map<string, FolderItem>();
  const untaggedRequests: RequestItem[] = [];

  const pathsObj = isObject(doc.paths) ? doc.paths : {};

  for (const [rawPathPattern, rawPathItem] of Object.entries(pathsObj)) {
    const pathItem = resolveRef(doc, rawPathItem);
    if (!isObject(pathItem)) continue;

    const pathLevelParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];

    for (const verb of HTTP_METHODS) {
      const operation = pathItem[verb];
      if (!isObject(operation)) continue;

      const opLevelParams = Array.isArray(operation.parameters) ? operation.parameters : [];
      const mergedParamsMap = new Map<string, AnyRecord>();

      for (const p of [...pathLevelParams, ...opLevelParams]) {
        const resolvedParam = resolveRef(doc, p);
        if (!isObject(resolvedParam) || typeof resolvedParam.name !== 'string') continue;
        const paramKey = `${String(resolvedParam.in ?? 'query')}:${resolvedParam.name}`;
        mergedParamsMap.set(paramKey, resolvedParam);
      }

      const pathParams: PathParamEntry[] = [];
      const queryParams: QueryParamEntry[] = [];
      const headers: KeyValueEntry[] = [];
      const bodyParams: AnyRecord[] = [];
      const formParams: AnyRecord[] = [];

      for (const param of mergedParamsMap.values()) {
        const location = String(param.in ?? 'query');
        const paramName = String(param.name);
        const paramDesc =
          typeof param.description === 'string' ? param.description : undefined;
        const sampleVal = extractParameterSampleValue(doc, param);

        if (location === 'path') {
          pathParams.push({
            key: paramName,
            value: sampleVal,
            ...(paramDesc ? { description: paramDesc } : {}),
          });
        } else if (location === 'query') {
          queryParams.push({
            key: paramName,
            value: sampleVal,
            enabled: param.required !== false,
            ...(paramDesc ? { description: paramDesc } : {}),
          });
        } else if (location === 'header') {
          headers.push({
            key: paramName,
            value: sampleVal,
            enabled: true,
            ...(paramDesc ? { description: paramDesc } : {}),
          });
        } else if (location === 'body') {
          bodyParams.push(param);
        } else if (location === 'formData') {
          formParams.push(param);
        }
      }

      // Convert `/users/{id}` to `{{baseUrl}}/users/:id`
      const normalizedPath = rawPathPattern
        .replace(/\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/g, ':$1')
        .replace(/^([^/])/, '/$1');

      // Ensure any `:param` in path is represented in pathParams
      const pathParamMatches = normalizedPath.matchAll(/\/:([a-zA-Z_][a-zA-Z0-9_-]*)/g);
      for (const match of pathParamMatches) {
        const pName = match[1];
        if (!pathParams.some(pp => pp.key === pName)) {
          pathParams.push({ key: pName, value: '' });
        }
      }

      const baseUrlWithPath = `{{baseUrl}}${normalizedPath}`;
      const fullUrl = syncUrlFromQueryParams(baseUrlWithPath, queryParams);

      const body = buildRequestBody(doc, operation, bodyParams, formParams, headers);

      const opSecurity = resolveSecurityArray(operation.security);
      const auth: AuthConfig = opSecurity ?? { type: 'inherit' };

      const reqName =
        (typeof operation.summary === 'string' && operation.summary.trim()) ||
        (typeof operation.operationId === 'string' && operation.operationId.trim()) ||
        `${verb.toUpperCase()} ${rawPathPattern}`;

      const reqDesc =
        typeof operation.description === 'string' && operation.description.trim()
          ? operation.description.trim()
          : undefined;

      const requestItem = createDefaultHttpRequest({
        name: reqName,
        description: reqDesc,
        method: verb.toUpperCase(),
        url: fullUrl,
        queryParams,
        pathParams,
        headers,
        auth,
        body,
      });

      const tags = Array.isArray(operation.tags)
        ? operation.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        : [];

      if (tags.length > 0) {
        const primaryTag = tags[0].trim();
        let folder = foldersByTag.get(primaryTag);
        if (!folder) {
          folder = createDefaultFolder(primaryTag, [], {
            description: tagDescriptions.get(primaryTag),
          });
          foldersByTag.set(primaryTag, folder);
        }
        folder.items.push(requestItem);
      } else {
        untaggedRequests.push(requestItem);
      }
    }
  }

  const items: CollectionTreeItem[] = [
    ...Array.from(foldersByTag.values()),
    ...untaggedRequests,
  ];

  return {
    awapiLasso: AWJC_SCHEMA_VERSION,
    kind: 'Collection',
    metadata: {
      id: generateAwjcId('col'),
      name: title,
      ...(description ? { description } : {}),
      version,
    },
    defaults: {
      baseUrl: '{{baseUrl}}',
      timeoutMs: 30000,
      followRedirects: true,
      verifySsl: true,
      ...(defaultAuth ? { auth: defaultAuth } : {}),
    },
    ...(authProfiles.length > 0 ? { authProfiles } : {}),
    variables: collectionVariables,
    activeEnvironment: environments[0]?.name ?? 'default',
    environments,
    items,
  };
}
