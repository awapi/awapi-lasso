export const AWJC_SCHEMA_VERSION = '1.0';

export type RequestProtocol = 'http' | 'graphql';

export type StandardHttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'
  | 'TRACE'
  | 'CONNECT';

export type HttpMethod = StandardHttpMethod | string;

export interface KeyValueEntry {
  key: string;
  value?: string;
  enabled: boolean;
  description?: string;
  secret?: boolean;
  /** Keeps the value out of the AI assistant's view. Unlike `secret`, the value is still saved in the file. */
  hideFromAi?: boolean;
}

export interface QueryParamEntry extends KeyValueEntry {}

export interface PathParamEntry {
  key: string;
  value?: string;
  description?: string;
  secret?: boolean;
}

export interface VariableEntry {
  key: string;
  value?: string;
  enabled: boolean;
  description?: string;
  secret?: boolean;
  /** Keeps the value out of the AI assistant's view. Unlike `secret`, the value is still saved in the file. */
  hideFromAi?: boolean;
}

export type FormDataFieldType = 'text' | 'file';

export interface FormDataEntry {
  key: string;
  type: FormDataFieldType;
  value?: string;
  filePath?: string;
  contentType?: string;
  enabled: boolean;
  description?: string;
  secret?: boolean;
}

export type RequestBodyMode =
  | 'none'
  | 'json'
  | 'yaml'
  | 'xml'
  | 'html'
  | 'text'
  | 'form-urlencoded'
  | 'multipart-form'
  | 'binary';

export interface RequestBodyConfig {
  mode: RequestBodyConfigMode;
  content?: string;
  urlEncoded?: KeyValueEntry[];
  formData?: FormDataEntry[];
  binaryFilePath?: string;
  contentType?: string;
}

export type RequestBodyConfigMode = RequestBodyMode;

export type GraphQLSchemaSourceMode = 'introspect' | 'sdl_file' | 'json_file';

export interface GraphQLSchemaSource {
  mode: GraphQLSchemaSourceMode;
  autoIntrospectOnOpen?: boolean;
  localSchemaPath?: string;
}

export interface GraphQLConfig {
  operationName?: string;
  query: string;
  variables?: string;
  schemaSource?: GraphQLSchemaSource;
}

export type OAuth2GrantType =
  | 'password'
  | 'client_credentials'
  | 'authorization_code'
  | 'authorization_code_pkce'
  | 'refresh_token';

export type OAuth2ClientAuthMethod = 'basic_header' | 'request_body';

export interface OAuth2Config {
  grantType: OAuth2GrantType;
  accessTokenUrl: string;
  authorizationUrl?: string;
  redirectUri?: string;
  clientId: string;
  clientSecret?: string;
  clientSecretIsSecret?: boolean;
  username?: string;
  password?: string;
  passwordIsSecret?: boolean;
  refreshToken?: string;
  scope?: string;
  clientAuthMethod?: OAuth2ClientAuthMethod;
  tokenHeaderPrefix?: string;
  pkceCodeChallengeMethod?: 'S256' | 'plain';
  autoRefresh?: boolean;
  extraParams?: KeyValueEntry[];
}

export interface BearerAuthConfig {
  token: string;
  prefix?: string;
  secret?: boolean;
}

export interface BasicAuthConfig {
  username: string;
  password?: string;
  secret?: boolean;
}

export interface ApiKeyAuthConfig {
  key: string;
  value?: string;
  in: 'header' | 'query';
  secret?: boolean;
}

export interface DigestAuthConfig {
  username: string;
  password?: string;
  realm?: string;
  secret?: boolean;
}

export interface AwsV4AuthConfig {
  accessKeyId: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region: string;
  service: string;
  secret?: boolean;
}

export type AuthType =
  | 'inherit'
  | 'none'
  | 'profile'
  | 'bearer'
  | 'basic'
  | 'apikey'
  | 'digest'
  | 'awsv4'
  | 'oauth2';

export interface AuthConfig {
  type: AuthType;
  profileId?: string;
  bearer?: BearerAuthConfig;
  basic?: BasicAuthConfig;
  apikey?: ApiKeyAuthConfig;
  digest?: DigestAuthConfig;
  awsv4?: AwsV4AuthConfig;
  oauth2?: OAuth2Config;
}

export interface AuthProfile extends AuthConfig {
  id: string;
  name: string;
  description?: string;
}

export type CaptureScope = 'environment' | 'collection' | 'runtime';
export type CaptureSource = 'jsonpath' | 'header' | 'cookie' | 'status' | 'body';

export interface CaptureRule {
  variable: string;
  scope: CaptureScope;
  source: CaptureSource;
  expression?: string;
  enabled?: boolean;
  secret?: boolean;
}

export type AssertionTarget = 'status' | 'responseTime' | 'header' | 'jsonpath' | 'body';

export type AssertionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'matchesRegex'
  | 'lessThan'
  | 'greaterThan'
  | 'in'
  | 'isDefined'
  | 'isUndefined'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'isArray';

export interface AssertionRule {
  target: AssertionTarget;
  path?: string;
  headerName?: string;
  operator: AssertionOperator;
  expected?: string | number | boolean | Array<string | number>;
  enabled?: boolean;
}

export interface RequestItem {
  kind: 'request';
  id: string;
  name: string;
  description?: string;
  protocol: RequestProtocol;
  method: HttpMethod;
  url: string;
  queryParams?: QueryParamEntry[];
  pathParams?: PathParamEntry[];
  headers?: KeyValueEntry[];
  auth?: AuthConfig;
  body?: RequestBodyConfig;
  graphql?: GraphQLConfig;
  captures?: CaptureRule[];
  assertions?: AssertionRule[];
}

export interface FolderItem {
  kind: 'folder';
  id: string;
  name: string;
  description?: string;
  auth?: AuthConfig;
  headers?: KeyValueEntry[];
  variables?: VariableEntry[];
  items: CollectionTreeItem[];
}

export type CollectionTreeItem = FolderItem | RequestItem;

export interface EnvironmentConfig {
  id: string;
  name: string;
  color?: string;
  variables: VariableEntry[];
}

export interface CollectionMetadata {
  id: string;
  name: string;
  description?: string;
  version?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CollectionDefaults {
  baseUrl?: string;
  timeoutMs?: number;
  followRedirects?: boolean;
  verifySsl?: boolean;
  headers?: KeyValueEntry[];
  auth?: AuthConfig;
}

export interface AwjcCollection {
  awapiLasso: string;
  kind: 'Collection';
  metadata: CollectionMetadata;
  defaults?: CollectionDefaults;
  authProfiles?: AuthProfile[];
  variables?: VariableEntry[];
  activeEnvironment?: string;
  environments?: EnvironmentConfig[];
  items: CollectionTreeItem[];
}

let idCounter = 0;

/** Generates a deterministic-friendly unique ID with the given prefix. */
export function generateAwjcId(prefix: string): string {
  idCounter = (idCounter + 1) % 100000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${rand}`;
}

export function createDefaultEnvironment(
  name = 'local',
  color = '#22c55e',
  variables: VariableEntry[] = [
    { key: 'baseUrl', value: 'http://localhost:8080', enabled: true },
  ],
): EnvironmentConfig {
  return {
    id: generateAwjcId('env'),
    name,
    color,
    variables,
  };
}

export function createDefaultHttpRequest(
  overrides: Partial<RequestItem> = {},
): RequestItem {
  return {
    kind: 'request',
    id: overrides.id ?? generateAwjcId('req'),
    name: overrides.name ?? 'New HTTP Request',
    protocol: 'http',
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '{{baseUrl}}/health',
    queryParams: overrides.queryParams ?? [],
    pathParams: overrides.pathParams ?? [],
    headers: overrides.headers ?? [],
    auth: overrides.auth ?? { type: 'inherit' },
    body: overrides.body ?? { mode: 'none' },
    captures: overrides.captures ?? [],
    assertions: overrides.assertions ?? [],
    ...(overrides.description ? { description: overrides.description } : {}),
  };
}

export function createDefaultGraphQLRequest(
  overrides: Partial<RequestItem> = {},
): RequestItem {
  return {
    kind: 'request',
    id: overrides.id ?? generateAwjcId('req'),
    name: overrides.name ?? 'New GraphQL Request',
    protocol: 'graphql',
    method: overrides.method ?? 'POST',
    url: overrides.url ?? '{{baseUrl}}/graphql',
    queryParams: overrides.queryParams ?? [],
    pathParams: overrides.pathParams ?? [],
    headers: overrides.headers ?? [
      { key: 'Content-Type', value: 'application/json', enabled: true },
    ],
    auth: overrides.auth ?? { type: 'inherit' },
    graphql: overrides.graphql ?? {
      operationName: '',
      query: 'query {\n  __typename\n}\n',
      variables: '{\n}\n',
      schemaSource: {
        mode: 'introspect',
        autoIntrospectOnOpen: true,
        localSchemaPath: '',
      },
    },
    captures: overrides.captures ?? [],
    assertions: overrides.assertions ?? [],
    ...(overrides.description ? { description: overrides.description } : {}),
  };
}

export function createDefaultFolder(
  name = 'New Folder',
  items: CollectionTreeItem[] = [],
  overrides: Partial<FolderItem> = {},
): FolderItem {
  return {
    kind: 'folder',
    id: overrides.id ?? generateAwjcId('fld'),
    name,
    ...(overrides.description ? { description: overrides.description } : {}),
    auth: overrides.auth ?? { type: 'inherit' },
    headers: overrides.headers ?? [],
    ...(overrides.variables ? { variables: overrides.variables } : {}),
    items,
  };
}

export function createEmptyCollection(
  name = 'Untitled Collection',
  overrides: Partial<AwjcCollection> = {},
): AwjcCollection {
  const now = new Date().toISOString();
  const defaultEnv = createDefaultEnvironment('local', '#22c55e');

  return {
    awapiLasso: overrides.awapiLasso ?? AWJC_SCHEMA_VERSION,
    kind: 'Collection',
    metadata: {
      id: overrides.metadata?.id ?? generateAwjcId('col'),
      name: overrides.metadata?.name ?? name,
      description: overrides.metadata?.description ?? '',
      createdAt: overrides.metadata?.createdAt ?? now,
      updatedAt: overrides.metadata?.updatedAt ?? now,
    },
    defaults: overrides.defaults ?? {
      baseUrl: '{{baseUrl}}',
      timeoutMs: 30000,
      followRedirects: true,
      verifySsl: true,
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      auth: { type: 'none' },
    },
    authProfiles: overrides.authProfiles ?? [],
    variables: overrides.variables ?? [],
    activeEnvironment: overrides.activeEnvironment ?? defaultEnv.name,
    environments: overrides.environments ?? [defaultEnv],
    items: overrides.items ?? [],
  };
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

function validateTreeItem(item: unknown, pathPrefix: string, errors: string[]): void {
  if (!item || typeof item !== 'object') {
    errors.push(`${pathPrefix}: must be an object`);
    return;
  }
  const obj = item as Record<string, unknown>;
  if (obj.kind === 'folder') {
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
      errors.push(`${pathPrefix}: folder.id is required`);
    }
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
      errors.push(`${pathPrefix}: folder.name is required`);
    }
    if (!Array.isArray(obj.items)) {
      errors.push(`${pathPrefix}: folder.items must be an array`);
    } else {
      obj.items.forEach((child, idx) =>
        validateTreeItem(child, `${pathPrefix}.items[${idx}]`, errors),
      );
    }
  } else if (obj.kind === 'request') {
    if (typeof obj.id !== 'string' || !obj.id.trim()) {
      errors.push(`${pathPrefix}: request.id is required`);
    }
    if (typeof obj.name !== 'string' || !obj.name.trim()) {
      errors.push(`${pathPrefix}: request.name is required`);
    }
    if (obj.protocol !== 'http' && obj.protocol !== 'graphql') {
      errors.push(`${pathPrefix}: request.protocol must be 'http' or 'graphql'`);
    }
    if (typeof obj.method !== 'string' || !obj.method.trim()) {
      errors.push(`${pathPrefix}: request.method is required`);
    }
    if (typeof obj.url !== 'string') {
      errors.push(`${pathPrefix}: request.url must be a string`);
    }
  } else {
    errors.push(`${pathPrefix}: item.kind must be 'folder' or 'request'`);
  }
}

/**
 * Validates an unknown object against the `.awjc` / `.awj` collection schema.
 */
export function validateAwjcCollection(doc: unknown): SchemaValidationResult {
  const errors: string[] = [];

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { valid: false, errors: ['Root document must be a YAML/JSON object'] };
  }

  const root = doc as Record<string, unknown>;

  if (typeof root.awapiLasso !== 'string' || !root.awapiLasso.trim()) {
    errors.push('Missing or invalid "awapiLasso" schema version string');
  }
  if (root.kind !== 'Collection') {
    errors.push('Field "kind" must equal "Collection"');
  }

  if (!root.metadata || typeof root.metadata !== 'object' || Array.isArray(root.metadata)) {
    errors.push('Field "metadata" is required and must be an object');
  } else {
    const meta = root.metadata as Record<string, unknown>;
    if (typeof meta.id !== 'string' || !meta.id.trim()) {
      errors.push('Field "metadata.id" is required');
    }
    if (typeof meta.name !== 'string' || !meta.name.trim()) {
      errors.push('Field "metadata.name" is required');
    }
  }

  if (!Array.isArray(root.items)) {
    errors.push('Field "items" is required and must be an array');
  } else {
    root.items.forEach((item, idx) => validateTreeItem(item, `items[${idx}]`, errors));
  }

  return { valid: errors.length === 0, errors };
}
