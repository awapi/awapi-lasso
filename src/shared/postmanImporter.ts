import {
  AWJC_SCHEMA_VERSION,
  createDefaultFolder,
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
  generateAwjcId,
  type AuthConfig,
  type AwjcCollection,
  type CollectionTreeItem,
  type EnvironmentConfig,
  type FormDataEntry,
  type GraphQLConfig,
  type KeyValueEntry,
  type OAuth2Config,
  type OAuth2GrantType,
  type PathParamEntry,
  type QueryParamEntry,
  type RequestBodyConfig,
  type RequestBodyMode,
  type RequestItem,
  type VariableEntry,
} from './collectionSchema';
import {
  ENVIRONMENT_COLORS,
  WarningCollector,
  asString,
  convertTestScript,
  isObject,
  looksSecret,
  mapDynamicVariables,
  type AnyRecord,
  type CollectionImportResult,
  type ConvertedScript,
  type ScriptDialect,
} from './importerUtils';
import { extractPathParamNames, syncQueryParamsFromUrl, syncUrlFromQueryParams } from './urlParams';

export type PostmanImportResult = CollectionImportResult;

export type PostmanFileKind = 'collection' | 'environment' | 'globals' | 'unknown';

export interface PostmanSourceFile {
  name: string;
  content: string;
}

export interface PostmanFilesImportResult extends PostmanImportResult {
  /** `name` of the file that held the collection. */
  collectionFile: string;
}

/** Postman descriptions are either a string or `{ content, type }`. */
function readDescription(val: unknown): string | undefined {
  const text = isObject(val) ? asString(val.content) : asString(val);
  const trimmed = text?.trim();
  return trimmed ? trimmed : undefined;
}

function convertKeyValueList(raw: unknown, markSecrets: boolean): KeyValueEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: KeyValueEntry[] = [];
  for (const row of raw) {
    if (!isObject(row)) continue;
    const key = asString(row.key) ?? '';
    if (!key) continue;
    const value = asString(row.value) ?? '';
    const description = readDescription(row.description);
    entries.push({
      key,
      value,
      enabled: row.disabled !== true,
      ...(description ? { description } : {}),
      ...(markSecrets && looksSecret(key, value) ? { secret: true } : {}),
    });
  }
  return entries;
}

/** Older exports store headers as a `Key: value\n...` string. */
function convertHeaders(raw: unknown): KeyValueEntry[] {
  if (typeof raw === 'string') {
    const rows = raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const disabled = line.startsWith('//');
        const body = disabled ? line.slice(2).trim() : line;
        const idx = body.indexOf(':');
        return idx === -1
          ? { key: body, value: '', disabled }
          : { key: body.slice(0, idx).trim(), value: body.slice(idx + 1).trim(), disabled };
      });
    return convertKeyValueList(rows, true);
  }
  return convertKeyValueList(raw, true);
}

function convertVariables(raw: unknown): VariableEntry[] {
  if (!Array.isArray(raw)) return [];
  const vars: VariableEntry[] = [];
  for (const row of raw) {
    if (!isObject(row)) continue;
    const key = asString(row.key) ?? asString(row.id) ?? '';
    if (!key) continue;
    const value = asString(row.value) ?? '';
    const description = readDescription(row.description);
    // Collections use `disabled`; environment exports use `enabled`.
    const enabled = row.disabled !== true && row.enabled !== false;
    vars.push({
      key,
      value,
      enabled,
      ...(description ? { description } : {}),
      ...(looksSecret(key, value, row.type === 'secret') ? { secret: true } : {}),
    });
  }
  return vars;
}

/**
 * Normalizes auth parameters into a flat record. v2.1 stores them as
 * `[{ key, value }]`; v2.0 stores them as a plain object.
 */
function readAuthParams(raw: AnyRecord, type: string): AnyRecord {
  const params = raw[type];
  if (Array.isArray(params)) {
    const out: AnyRecord = {};
    for (const p of params) {
      if (isObject(p) && typeof p.key === 'string') out[p.key] = p.value;
    }
    return out;
  }
  return isObject(params) ? params : {};
}

const OAUTH2_GRANT_TYPES: Record<string, OAuth2GrantType> = {
  authorization_code: 'authorization_code',
  authorization_code_with_pkce: 'authorization_code_pkce',
  client_credentials: 'client_credentials',
  password_credentials: 'password',
};

function convertOAuth2(
  params: AnyRecord,
  label: string,
  warnings: WarningCollector,
): AuthConfig {
  const str = (key: string) => asString(params[key]) ?? '';
  const rawGrant = str('grant_type');
  const accessTokenUrl = str('accessTokenUrl');

  // Old exports often keep only a pasted access token with no flow configuration.
  if (!rawGrant && !accessTokenUrl && str('accessToken')) {
    const token = str('accessToken');
    return {
      type: 'bearer',
      bearer: {
        token,
        prefix: str('headerPrefix') || 'Bearer',
        ...(looksSecret('token', token) ? { secret: true } : {}),
      },
    };
  }

  let grantType = OAUTH2_GRANT_TYPES[rawGrant || 'authorization_code'];
  if (!grantType) {
    grantType = 'authorization_code_pkce';
    warnings.addFor(
      `OAuth 2.0 grant "${rawGrant}" is not supported and was converted to Authorization Code + PKCE`,
      label,
    );
  }
  if (params.addTokenTo === 'queryParams') {
    warnings.addFor('OAuth 2.0 tokens sent as query parameters are now sent as a header', label);
  }

  const clientSecret = str('clientSecret');
  const password = str('password');
  const challenge = str('challengeAlgorithm');
  const oauth2: OAuth2Config = {
    grantType,
    accessTokenUrl,
    clientId: str('clientId'),
    ...(str('authUrl') ? { authorizationUrl: str('authUrl') } : {}),
    ...(str('redirect_uri') ? { redirectUri: str('redirect_uri') } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(looksSecret('clientSecret', clientSecret) ? { clientSecretIsSecret: true } : {}),
    ...(str('username') ? { username: str('username') } : {}),
    ...(password ? { password } : {}),
    ...(looksSecret('password', password) ? { passwordIsSecret: true } : {}),
    ...(str('scope') ? { scope: str('scope') } : {}),
    ...(params.client_authentication === 'body'
      ? { clientAuthMethod: 'request_body' as const }
      : params.client_authentication === 'header'
        ? { clientAuthMethod: 'basic_header' as const }
        : {}),
    ...(str('headerPrefix') ? { tokenHeaderPrefix: str('headerPrefix') } : {}),
    ...(challenge === 'S256' || challenge === 'plain'
      ? { pkceCodeChallengeMethod: challenge }
      : {}),
  };
  return { type: 'oauth2', oauth2 };
}

/**
 * Converts a Postman auth block. Returns `undefined` when the block is absent (meaning "inherit").
 */
function convertAuth(
  raw: unknown,
  label: string,
  warnings: WarningCollector,
): AuthConfig | undefined {
  if (!isObject(raw)) return undefined;
  const type = asString(raw.type)?.toLowerCase() ?? '';
  if (!type || type === 'inherit') return undefined;
  if (type === 'noauth') return { type: 'none' };

  const params = readAuthParams(raw, type);
  const str = (key: string) => asString(params[key]) ?? '';

  switch (type) {
    case 'basic': {
      const password = str('password');
      return {
        type: 'basic',
        basic: {
          username: str('username'),
          password,
          ...(looksSecret('password', password) ? { secret: true } : {}),
        },
      };
    }
    case 'bearer': {
      const token = str('token');
      return {
        type: 'bearer',
        bearer: {
          token,
          prefix: 'Bearer',
          ...(looksSecret('token', token) ? { secret: true } : {}),
        },
      };
    }
    case 'apikey': {
      const value = str('value');
      return {
        type: 'apikey',
        apikey: {
          key: str('key') || 'X-API-Key',
          value,
          in: params.in === 'query' ? 'query' : 'header',
          ...(looksSecret('apiKey', value) ? { secret: true } : {}),
        },
      };
    }
    case 'digest': {
      const password = str('password');
      return {
        type: 'digest',
        digest: {
          username: str('username'),
          password,
          ...(str('realm') ? { realm: str('realm') } : {}),
          ...(looksSecret('password', password) ? { secret: true } : {}),
        },
      };
    }
    case 'awsv4': {
      const secretAccessKey = str('secretKey');
      return {
        type: 'awsv4',
        awsv4: {
          accessKeyId: str('accessKey'),
          secretAccessKey,
          ...(str('sessionToken') ? { sessionToken: str('sessionToken') } : {}),
          region: str('region'),
          service: str('service'),
          ...(looksSecret('secretAccessKey', secretAccessKey) ? { secret: true } : {}),
        },
      };
    }
    case 'oauth2':
      return convertOAuth2(params, label, warnings);
    default:
      warnings.addFor(`Auth type "${type}" is not supported and was set to No Auth`, label);
      return { type: 'none' };
  }
}

interface ConvertedUrl {
  url: string;
  queryParams: QueryParamEntry[];
  pathParams: PathParamEntry[];
}

function joinUrlPart(val: unknown, sep: string): string {
  if (Array.isArray(val)) return val.map(v => asString(v) ?? '').join(sep);
  return asString(val) ?? '';
}

function convertUrl(raw: unknown): ConvertedUrl {
  if (!isObject(raw)) {
    const url = asString(raw) ?? '';
    return {
      url,
      queryParams: syncQueryParamsFromUrl(url, []),
      pathParams: extractPathParamNames(url).map(key => ({ key, value: '' })),
    };
  }

  const queryParams: QueryParamEntry[] = convertKeyValueList(raw.query, false);
  let url = asString(raw.raw) ?? '';
  if (!url) {
    const protocol = asString(raw.protocol);
    const host = joinUrlPart(raw.host, '.');
    const port = asString(raw.port);
    const path = joinUrlPart(raw.path, '/');
    url =
      `${protocol ? `${protocol}://` : ''}${host}${port ? `:${port}` : ''}` +
      `${path ? `/${path.replace(/^\//, '')}` : ''}`;
    url = syncUrlFromQueryParams(url, queryParams);
  }
  // Some exports omit the structured `query` list and keep the params only in `raw`.
  const finalQuery = queryParams.length > 0 ? queryParams : syncQueryParamsFromUrl(url, []);

  const declared = new Map<string, PathParamEntry>();
  if (Array.isArray(raw.variable)) {
    for (const v of raw.variable) {
      if (!isObject(v)) continue;
      const key = asString(v.key) ?? asString(v.id);
      if (!key) continue;
      const description = readDescription(v.description);
      declared.set(key, {
        key,
        value: asString(v.value) ?? '',
        ...(description ? { description } : {}),
      });
    }
  }
  const pathParams = extractPathParamNames(url).map(
    key => declared.get(key) ?? { key, value: '' },
  );

  return { url, queryParams: finalQuery, pathParams };
}

const RAW_LANGUAGE_MODES: Record<string, RequestBodyMode> = {
  json: 'json',
  xml: 'xml',
  html: 'html',
  text: 'text',
  javascript: 'text',
  yaml: 'yaml',
};

function bodyModeFromContentType(headers: KeyValueEntry[]): RequestBodyMode | undefined {
  const contentType = headers
    .find(h => h.enabled && h.key.toLowerCase() === 'content-type')
    ?.value?.toLowerCase();
  if (!contentType) return undefined;
  if (contentType.includes('json')) return 'json';
  if (contentType.includes('yaml')) return 'yaml';
  if (contentType.includes('xml')) return 'xml';
  if (contentType.includes('html')) return 'html';
  return 'text';
}

type ConvertedBody =
  | { kind: 'http'; body: RequestBodyConfig }
  | { kind: 'graphql'; graphql: GraphQLConfig };

function convertBody(
  raw: unknown,
  headers: KeyValueEntry[],
  label: string,
  warnings: WarningCollector,
): ConvertedBody {
  const none: ConvertedBody = { kind: 'http', body: { mode: 'none' } };
  if (!isObject(raw) || raw.disabled === true) return none;
  const mode = asString(raw.mode) ?? '';

  switch (mode) {
    case 'raw': {
      const content = asString(raw.raw) ?? '';
      if (!content) return none;
      const options = isObject(raw.options) && isObject(raw.options.raw) ? raw.options.raw : {};
      const language = asString(options.language)?.toLowerCase();
      const bodyMode =
        (language ? RAW_LANGUAGE_MODES[language] : undefined) ??
        bodyModeFromContentType(headers) ??
        'text';
      return { kind: 'http', body: { mode: bodyMode, content } };
    }
    case 'urlencoded':
      return {
        kind: 'http',
        body: { mode: 'form-urlencoded', urlEncoded: convertKeyValueList(raw.urlencoded, false) },
      };
    case 'formdata': {
      const formData: FormDataEntry[] = [];
      for (const row of Array.isArray(raw.formdata) ? raw.formdata : []) {
        if (!isObject(row)) continue;
        const key = asString(row.key) ?? '';
        if (!key) continue;
        const description = readDescription(row.description);
        const contentType = asString(row.contentType);
        const common = {
          key,
          enabled: row.disabled !== true,
          ...(description ? { description } : {}),
          ...(contentType ? { contentType } : {}),
        };
        if (row.type === 'file') {
          const sources = Array.isArray(row.src) ? row.src : [row.src];
          const filePath = asString(sources[0]) ?? '';
          if (sources.length > 1) {
            warnings.addFor('Only the first file of multi-file form fields was kept', label);
          }
          formData.push({ ...common, type: 'file', filePath });
        } else {
          formData.push({ ...common, type: 'text', value: asString(row.value) ?? '' });
        }
      }
      return { kind: 'http', body: { mode: 'multipart-form', formData } };
    }
    case 'file': {
      const src = isObject(raw.file) ? asString(raw.file.src) : undefined;
      return { kind: 'http', body: { mode: 'binary', ...(src ? { binaryFilePath: src } : {}) } };
    }
    case 'graphql': {
      const gql = isObject(raw.graphql) ? raw.graphql : {};
      const variables = asString(gql.variables)?.trim();
      return {
        kind: 'graphql',
        graphql: {
          operationName: '',
          query: asString(gql.query) ?? '',
          variables: variables || '{\n}\n',
          schemaSource: { mode: 'introspect', autoIntrospectOnOpen: false, localSchemaPath: '' },
        },
      };
    }
    default:
      if (mode) warnings.addFor(`Body mode "${mode}" is not supported and was dropped`, label);
      return none;
  }
}

/** Reads `exec` lines from the events of the given `listen` type (`test` or `prerequest`). */
function readScript(events: unknown, listen: string): string {
  if (!Array.isArray(events)) return '';
  return events
    .filter(e => isObject(e) && e.listen === listen && e.disabled !== true)
    .map(e => {
      const script = isObject(e) && isObject(e.script) ? e.script : {};
      return Array.isArray(script.exec)
        ? script.exec.map(line => asString(line) ?? '').join('\n')
        : (asString(script.exec) ?? '');
    })
    .join('\n')
    .trim();
}

const POSTMAN_SCRIPT_DIALECT: ScriptDialect = {
  statusPatterns: [
    /pm\.response\.to\.have\.status\(\s*(\d{3})\s*\)/g,
    /pm\.expect\(\s*pm\.response\.code\s*\)\.to\.(?:eql|equal|be\.equal)\(\s*(\d{3})\s*\)/g,
  ],
  bodySources: [String.raw`pm\.response\.json\(\)`, String.raw`JSON\.parse\(\s*responseBody\s*\)`],
  headerReads: [String.raw`pm\.response\.headers\.get\(\s*['"]([^'"]+)['"]\s*\)`],
  setter: String.raw`pm\.(environment|collectionVariables|globals|variables)\.set`,
  setterScopes: {
    environment: 'environment',
    collectionVariables: 'collection',
    globals: 'collection',
    variables: 'runtime',
  },
  testWrapper:
    /pm\.test\(\s*(['"`])[^'"`]*\1\s*,\s*(?:async\s+)?(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{/g,
};

/**
 * Converts the most common Postman test-script idioms into declarative assertions and captures.
 * `fullyConverted` is true when nothing but those idioms (plus `pm.test` wrappers and comments)
 * was in the script, so the caller only warns when logic was actually left behind.
 */
export function convertPostmanTestScript(script: string): ConvertedScript {
  return convertTestScript(script, POSTMAN_SCRIPT_DIALECT);
}

interface ConvertContext {
  warnings: WarningCollector;
}

function reportScripts(events: unknown, label: string, ctx: ConvertContext): void {
  if (readScript(events, 'prerequest')) {
    ctx.warnings.addFor('Pre-request scripts were not imported', label);
  }
}

function convertRequestItem(raw: AnyRecord, ctx: ConvertContext): RequestItem {
  const name = asString(raw.name)?.trim() || 'Untitled Request';
  const request = isObject(raw.request)
    ? raw.request
    : { url: raw.request, method: 'GET' };

  const method = (asString(request.method) ?? 'GET').toUpperCase();
  const headers = convertHeaders(request.header);
  const { url, queryParams, pathParams } = convertUrl(request.url);
  const auth = convertAuth(request.auth, name, ctx.warnings) ?? { type: 'inherit' };
  const description = readDescription(request.description) ?? readDescription(raw.description);

  reportScripts(raw.event, name, ctx);
  const testScript = readScript(raw.event, 'test');
  const { assertions, captures, fullyConverted } = convertPostmanTestScript(testScript);
  if (!fullyConverted) {
    ctx.warnings.addFor(
      assertions.length + captures.length > 0
        ? 'Test scripts were partly converted to assertions/captures; review them'
        : 'Test scripts were not imported',
      name,
    );
  }

  const converted = convertBody(request.body, headers, name, ctx.warnings);
  const common = {
    name,
    method,
    url,
    queryParams,
    pathParams,
    auth,
    assertions,
    captures,
    ...(description ? { description } : {}),
  };

  if (converted.kind === 'graphql') {
    const hasContentType = headers.some(h => h.key.toLowerCase() === 'content-type');
    return createDefaultGraphQLRequest({
      ...common,
      headers: hasContentType
        ? headers
        : [{ key: 'Content-Type', value: 'application/json', enabled: true }, ...headers],
      graphql: converted.graphql,
    });
  }
  return createDefaultHttpRequest({ ...common, headers, body: converted.body });
}

function convertItems(rawItems: unknown, ctx: ConvertContext): CollectionTreeItem[] {
  if (!Array.isArray(rawItems)) return [];
  const items: CollectionTreeItem[] = [];
  for (const raw of rawItems) {
    if (!isObject(raw)) continue;
    if (Array.isArray(raw.item)) {
      const name = asString(raw.name)?.trim() || 'Untitled Folder';
      reportScripts(raw.event, name, ctx);
      if (readScript(raw.event, 'test')) {
        ctx.warnings.addFor('Folder test scripts were not imported', name);
      }
      const variables = convertVariables(raw.variable);
      const description = readDescription(raw.description);
      items.push(
        createDefaultFolder(name, convertItems(raw.item, ctx), {
          ...(description ? { description } : {}),
          auth: convertAuth(raw.auth, name, ctx.warnings) ?? { type: 'inherit' },
          ...(variables.length > 0 ? { variables } : {}),
        }),
      );
    } else {
      items.push(convertRequestItem(raw, ctx));
    }
  }
  return items;
}

/** Classifies a parsed JSON document as a Postman collection, environment, or globals export. */
export function detectPostmanFileKind(doc: unknown): PostmanFileKind {
  if (!isObject(doc)) return 'unknown';
  if (isObject(doc.info) && Array.isArray(doc.item)) return 'collection';
  if (Array.isArray(doc.values)) {
    if (doc._postman_variable_scope === 'globals') return 'globals';
    if (doc._postman_variable_scope === 'environment' || typeof doc.name === 'string') {
      return 'environment';
    }
  }
  return 'unknown';
}

function parseJson(input: string | AnyRecord, label: string): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input) as unknown;
  } catch (err) {
    throw new Error(
      `${label} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Converts a Postman environment export (`*.postman_environment.json`) into an environment. */
export function importPostmanEnvironment(
  input: string | AnyRecord,
  color = ENVIRONMENT_COLORS[0],
): EnvironmentConfig {
  const doc = parseJson(input, 'Postman environment');
  if (detectPostmanFileKind(doc) !== 'environment' || !isObject(doc)) {
    throw new Error('Not a Postman environment export: expected a "values" array');
  }
  return {
    id: generateAwjcId('env'),
    name: asString(doc.name)?.trim() || 'Imported Environment',
    color,
    variables: convertVariables(doc.values),
  };
}

function readVersion(info: AnyRecord): string | undefined {
  if (typeof info.version === 'string' && info.version.trim()) return info.version.trim();
  if (isObject(info.version)) {
    const { major, minor, patch } = info.version;
    if (major !== undefined) return `${String(major)}.${String(minor ?? 0)}.${String(patch ?? 0)}`;
  }
  return undefined;
}

/**
 * Imports a Postman Collection v2.0 / v2.1 export (JSON string or parsed object), optionally with
 * Postman environment exports, and converts it into an AwapiLasso `AwjcCollection`.
 */
export function importPostmanCollection(
  input: string | AnyRecord,
  options: { environments?: Array<string | AnyRecord>; globals?: Array<string | AnyRecord> } = {},
): PostmanImportResult {
  const doc = parseJson(input, 'Postman collection');
  if (isObject(doc) && Array.isArray(doc.requests)) {
    throw new Error(
      'Postman Collection v1 is not supported. In Postman, export the collection as v2.1 and import that file.',
    );
  }
  if (detectPostmanFileKind(doc) !== 'collection' || !isObject(doc)) {
    throw new Error(
      'Not a Postman collection: expected "info" and "item" fields (Postman Collection v2.0 / v2.1)',
    );
  }

  const warnings = new WarningCollector();
  const ctx: ConvertContext = { warnings };
  const info = isObject(doc.info) ? doc.info : {};
  const name = asString(info.name)?.trim() || 'Imported Postman Collection';
  const description = readDescription(info.description);
  const version = readVersion(info);

  if (readScript(doc.event, 'prerequest') || readScript(doc.event, 'test')) {
    warnings.add('Collection-level scripts were not imported.');
  }

  const variables = convertVariables(doc.variable);
  const known = new Set(variables.map(v => v.key));
  for (const g of options.globals ?? []) {
    const globalsDoc = parseJson(g, 'Postman globals');
    if (!isObject(globalsDoc)) continue;
    // Globals have the lowest precedence in Postman, so they only fill in keys the collection lacks.
    for (const v of convertVariables(globalsDoc.values)) {
      if (known.has(v.key)) continue;
      known.add(v.key);
      variables.push(v);
    }
  }

  const environments = (options.environments ?? []).map((env, idx) =>
    importPostmanEnvironment(env, ENVIRONMENT_COLORS[idx % ENVIRONMENT_COLORS.length]),
  );
  const defaultAuth = convertAuth(doc.auth, name, warnings) ?? { type: 'none' };
  const items = convertItems(doc.item, ctx);

  const unsupported = new Set<string>();
  const collection = mapDynamicVariables<AwjcCollection>(
    {
      awapiLasso: AWJC_SCHEMA_VERSION,
      kind: 'Collection',
      metadata: {
        id: generateAwjcId('col'),
        name,
        ...(description ? { description } : {}),
        ...(version ? { version } : {}),
      },
      defaults: {
        timeoutMs: 30000,
        followRedirects: true,
        verifySsl: true,
        auth: defaultAuth,
      },
      variables,
      ...(environments.length > 0
        ? { activeEnvironment: environments[0].name, environments }
        : { environments: [] }),
      items,
    },
    unsupported,
  );
  if (unsupported.size > 0) {
    warnings.add(
      `Postman dynamic variables without an AwapiLasso equivalent were left as-is: ${Array.from(unsupported).sort().join(', ')}.`,
    );
  }

  return { collection, warnings: warnings.list() };
}

/**
 * Imports a set of Postman export files picked together: exactly one collection plus any number of
 * environment and globals exports.
 */
export function importPostmanFiles(files: PostmanSourceFile[]): PostmanFilesImportResult {
  let collectionDoc: AnyRecord | undefined;
  let collectionFile = '';
  const environments: AnyRecord[] = [];
  const globals: AnyRecord[] = [];

  for (const file of files) {
    const doc = parseJson(file.content, `"${file.name}"`);
    if (isObject(doc) && Array.isArray(doc.requests)) {
      // Let importPostmanCollection raise its v1-specific message.
      importPostmanCollection(doc);
    }
    const kind = detectPostmanFileKind(doc);
    if (!isObject(doc) || kind === 'unknown') {
      throw new Error(`"${file.name}" is not a Postman collection, environment, or globals export`);
    }
    if (kind === 'collection') {
      if (collectionDoc) {
        throw new Error(
          `Pick one Postman collection at a time ("${collectionFile}" and "${file.name}" are both collections)`,
        );
      }
      collectionDoc = doc;
      collectionFile = file.name;
    } else if (kind === 'environment') {
      environments.push(doc);
    } else {
      globals.push(doc);
    }
  }

  if (!collectionDoc) {
    throw new Error('No Postman collection selected. Pick a collection export along with any environment files.');
  }
  return {
    ...importPostmanCollection(collectionDoc, { environments, globals }),
    collectionFile,
  };
}
