import {
  AWJC_SCHEMA_VERSION,
  createDefaultFolder,
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
  generateAwjcId,
  type AssertionOperator,
  type AssertionRule,
  type AuthConfig,
  type AwjcCollection,
  type CaptureRule,
  type CollectionTreeItem,
  type EnvironmentConfig,
  type FormDataEntry,
  type KeyValueEntry,
  type OAuth2Config,
  type OAuth2GrantType,
  type PathParamEntry,
  type QueryParamEntry,
  type RequestBodyConfig,
  type RequestItem,
  type VariableEntry,
} from './collectionSchema';
import {
  bruDict,
  bruDictValue,
  bruList,
  bruText,
  isBruMethodBlock,
  parseBru,
  type BruBlock,
  type BruDictEntry,
} from './bruParser';
import {
  ENVIRONMENT_COLORS,
  WarningCollector,
  asString,
  convertTestScript,
  isObject,
  looksSecret,
  mapDynamicVariables,
  toJsonPath,
  type AnyRecord,
  type CollectionImportResult,
  type ConvertedScript,
  type ScriptDialect,
} from './importerUtils';
import { extractPathParamNames, syncQueryParamsFromUrl } from './urlParams';

/** A file from a Bruno collection folder; `path` is relative to the folder and uses `/`. */
export interface BrunoSourceFile {
  path: string;
  content: string;
}

// ---------------------------------------------------------------------------
// `.bru` folder → Bruno's JSON export shape
// ---------------------------------------------------------------------------

function kvList(entries: BruDictEntry[]): AnyRecord[] {
  return entries.map(e => ({ name: e.key, value: e.value, enabled: e.enabled }));
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Collects every `auth:<mode>` block into `{ mode, <mode>: { ...camelCasedFields } }`. */
function bruAuth(blocks: BruBlock[], mode: string | undefined): AnyRecord {
  const auth: AnyRecord = { mode: mode ?? 'none' };
  for (const block of blocks) {
    if (block.kind !== 'dict' || !block.name.startsWith('auth:')) continue;
    const fields: AnyRecord = {};
    for (const e of block.entries) fields[snakeToCamel(e.key)] = e.value;
    auth[block.name.slice('auth:'.length)] = fields;
  }
  return auth;
}

/** Splits `@file(a|b) @contentType(x)` style multipart values. */
function parseAnnotatedValue(raw: string): { files?: string[]; value: string; contentType?: string } {
  let value = raw;
  let contentType: string | undefined;
  const ct = /\s*@contentType\(([^)]*)\)\s*$/.exec(value);
  if (ct) {
    contentType = ct[1].trim() || undefined;
    value = value.slice(0, ct.index);
  }
  const file = /^@file\(([^)]*)\)$/.exec(value.trim());
  if (file) {
    return { files: file[1].split('|').map(f => f.trim()).filter(Boolean), value: '', contentType };
  }
  return { value, contentType };
}

function bruBody(blocks: BruBlock[], mode: string | undefined): AnyRecord {
  return {
    mode: mode ?? 'none',
    json: bruText(blocks, 'body:json'),
    text: bruText(blocks, 'body:text'),
    xml: bruText(blocks, 'body:xml'),
    sparql: bruText(blocks, 'body:sparql'),
    formUrlEncoded: kvList(bruDict(blocks, 'body:form-urlencoded')),
    multipartForm: bruDict(blocks, 'body:multipart-form').map(e => {
      const parsed = parseAnnotatedValue(e.value);
      return parsed.files
        ? { type: 'file', name: e.key, value: parsed.files, contentType: parsed.contentType, enabled: e.enabled }
        : { type: 'text', name: e.key, value: parsed.value, contentType: parsed.contentType, enabled: e.enabled };
    }),
    file: bruDict(blocks, 'body:file').map(e => {
      const parsed = parseAnnotatedValue(e.value);
      return { filePath: parsed.files?.[0] ?? '', contentType: parsed.contentType, selected: e.enabled };
    }),
    graphql: { query: bruText(blocks, 'body:graphql'), variables: bruText(blocks, 'body:graphql:vars') },
  };
}

function bruCommon(blocks: BruBlock[], authMode: string | undefined): AnyRecord {
  return {
    headers: kvList(bruDict(blocks, 'headers')),
    auth: bruAuth(blocks, authMode),
    script: { req: bruText(blocks, 'script:pre-request'), res: bruText(blocks, 'script:post-response') },
    vars: {
      req: kvList(bruDict(blocks, 'vars:pre-request')),
      res: kvList(bruDict(blocks, 'vars:post-response')),
    },
    tests: bruText(blocks, 'tests'),
  };
}

function bruRequestItem(blocks: BruBlock[], fallbackName: string): AnyRecord {
  const methodBlock = blocks.find(b => b.kind === 'dict' && isBruMethodBlock(b.name));
  const method = methodBlock?.name ?? 'get';
  const field = (key: string) => bruDictValue(blocks, method, key);
  const query = [...bruDict(blocks, 'params:query'), ...bruDict(blocks, 'query')];
  const type = bruDictValue(blocks, 'meta', 'type');

  return {
    type: type === 'graphql' ? 'graphql-request' : 'http-request',
    name: bruDictValue(blocks, 'meta', 'name') || fallbackName,
    seq: Number(bruDictValue(blocks, 'meta', 'seq')) || undefined,
    request: {
      url: field('url') ?? '',
      method: method.toUpperCase(),
      params: [
        ...kvList(query).map(p => ({ ...p, type: 'query' })),
        ...kvList(bruDict(blocks, 'params:path')).map(p => ({ ...p, type: 'path' })),
      ],
      body: bruBody(blocks, field('body')),
      assertions: kvList(bruDict(blocks, 'assert')),
      docs: bruText(blocks, 'docs'),
      ...bruCommon(blocks, field('auth')),
    },
  };
}

/** `collection.bru` / `folder.bru`: auth mode lives in an `auth { mode: ... }` block. */
function bruRoot(blocks: BruBlock[]): AnyRecord {
  return {
    request: bruCommon(blocks, bruDictValue(blocks, 'auth', 'mode')),
    docs: bruText(blocks, 'docs'),
    meta: {
      name: bruDictValue(blocks, 'meta', 'name'),
      seq: Number(bruDictValue(blocks, 'meta', 'seq')) || undefined,
    },
  };
}

function bruEnvironment(blocks: BruBlock[], name: string): AnyRecord {
  return {
    name,
    variables: [
      ...bruDict(blocks, 'vars').map(e => ({ name: e.key, value: e.value, enabled: e.enabled, secret: false })),
      // Bruno keeps secret values out of the file, so only the names are known.
      ...bruList(blocks, 'vars:secret').map(i => ({ name: i.value, value: '', enabled: i.enabled, secret: true })),
    ],
  };
}

function baseName(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.bru$/i, '');
}

function sortItems(items: AnyRecord[]): AnyRecord[] {
  const seqOf = (item: AnyRecord): number => {
    const seq = item.type === 'folder' && isObject(item.root) && isObject(item.root.meta) ? item.root.meta.seq : item.seq;
    return typeof seq === 'number' ? seq : Number.MAX_SAFE_INTEGER;
  };
  const byOrder = (a: AnyRecord, b: AnyRecord) =>
    seqOf(a) - seqOf(b) || String(a.name).localeCompare(String(b.name));
  return [
    ...items.filter(i => i.type === 'folder').sort(byOrder),
    ...items.filter(i => i.type !== 'folder').sort(byOrder),
  ];
}

/**
 * Assembles the files of a Bruno collection folder into the same shape as Bruno's JSON export.
 */
export function parseBrunoCollectionFiles(files: BrunoSourceFile[]): AnyRecord {
  const byPath = new Map(files.map(f => [f.path.replace(/\\/g, '/').replace(/^\.\//, ''), f.content]));
  const configJson = byPath.get('bruno.json');
  if (configJson === undefined) {
    throw new Error('Not a Bruno collection folder: bruno.json was not found');
  }
  let config: unknown;
  try {
    config = JSON.parse(configJson) as unknown;
  } catch (err) {
    throw new Error(`bruno.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const folders = new Map<string, AnyRecord>();
  const root: AnyRecord = { items: [] as AnyRecord[] };
  const folderFor = (dir: string): AnyRecord => {
    if (!dir) return root;
    const existing = folders.get(dir);
    if (existing) return existing;
    const slash = dir.lastIndexOf('/');
    const folder: AnyRecord = { type: 'folder', name: dir.slice(slash + 1), items: [] as AnyRecord[] };
    folders.set(dir, folder);
    (folderFor(slash === -1 ? '' : dir.slice(0, slash)).items as AnyRecord[]).push(folder);
    return folder;
  };

  const environments: AnyRecord[] = [];
  let collectionRoot: AnyRecord | undefined;

  for (const [filePath, content] of [...byPath.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!filePath.toLowerCase().endsWith('.bru')) continue;
    const slash = filePath.lastIndexOf('/');
    const dir = slash === -1 ? '' : filePath.slice(0, slash);
    const fileName = filePath.slice(slash + 1).toLowerCase();
    const blocks = parseBru(content);

    if (dir === 'environments') {
      environments.push(bruEnvironment(blocks, baseName(filePath)));
    } else if (dir === '' && fileName === 'collection.bru') {
      collectionRoot = bruRoot(blocks);
    } else if (fileName === 'folder.bru') {
      const folder = folderFor(dir);
      folder.root = bruRoot(blocks);
      const metaName = isObject(folder.root) && isObject(folder.root.meta) ? asString(folder.root.meta.name) : undefined;
      if (metaName) folder.name = metaName;
    } else {
      (folderFor(dir).items as AnyRecord[]).push(bruRequestItem(blocks, baseName(filePath)));
    }
  }

  const sortTree = (items: AnyRecord[]): AnyRecord[] =>
    sortItems(items).map(i => (i.type === 'folder' ? { ...i, items: sortTree(i.items as AnyRecord[]) } : i));

  return {
    name: (isObject(config) && asString(config.name)) || 'Imported Bruno Collection',
    items: sortTree(root.items as AnyRecord[]),
    environments: environments.sort((a, b) => String(a.name).localeCompare(String(b.name))),
    ...(collectionRoot ? { root: collectionRoot } : {}),
  };
}

// ---------------------------------------------------------------------------
// Bruno JSON shape → AwapiLasso collection
// ---------------------------------------------------------------------------

interface ConvertContext {
  warnings: WarningCollector;
}

function list(val: unknown): AnyRecord[] {
  return Array.isArray(val) ? val.filter(isObject) : [];
}

function str(record: unknown, key: string): string {
  return isObject(record) ? (asString(record[key]) ?? '') : '';
}

function text(val: unknown): string | undefined {
  const s = asString(val)?.trim();
  return s ? s : undefined;
}

function convertKeyValues(raw: unknown, markSecrets: boolean): KeyValueEntry[] {
  return list(raw)
    .filter(row => str(row, 'name'))
    .map(row => {
      const key = str(row, 'name');
      const value = str(row, 'value');
      const description = text(row.description);
      return {
        key,
        value,
        enabled: row.enabled !== false,
        ...(description ? { description } : {}),
        ...(markSecrets && looksSecret(key, value) ? { secret: true } : {}),
      };
    });
}

function convertVariables(raw: unknown): VariableEntry[] {
  return list(raw)
    .filter(row => str(row, 'name'))
    .map(row => {
      const key = str(row, 'name');
      const value = str(row, 'value');
      return {
        key,
        value,
        enabled: row.enabled !== false,
        // Bruno secrets keep their (often empty) value outside the file; stay secret so it goes to the keychain.
        ...(row.secret === true || looksSecret(key, value) ? { secret: true } : {}),
      };
    });
}

const OAUTH2_GRANT_TYPES: Record<string, OAuth2GrantType> = {
  authorization_code: 'authorization_code',
  client_credentials: 'client_credentials',
  password: 'password',
};

function convertOAuth2(raw: unknown, label: string, warnings: WarningCollector): AuthConfig {
  const f = (key: string) => str(raw, key);
  const rawGrant = f('grantType') || 'authorization_code';
  let grantType = OAUTH2_GRANT_TYPES[rawGrant];
  if (!grantType) {
    grantType = 'authorization_code_pkce';
    warnings.addFor(
      `OAuth 2.0 grant "${rawGrant}" is not supported and was converted to Authorization Code + PKCE`,
      label,
    );
  }
  const pkce = isObject(raw) && (raw.pkce === true || raw.pkce === 'true');
  if (grantType === 'authorization_code' && pkce) grantType = 'authorization_code_pkce';
  if (f('tokenPlacement') === 'url') {
    warnings.addFor('OAuth 2.0 tokens sent as query parameters are now sent as a header', label);
  }

  const clientSecret = f('clientSecret');
  const password = f('password');
  const placement = f('credentialsPlacement');
  const autoRefresh = isObject(raw) ? raw.autoRefreshToken : undefined;
  const oauth2: OAuth2Config = {
    grantType,
    accessTokenUrl: f('accessTokenUrl'),
    clientId: f('clientId'),
    ...(f('authorizationUrl') ? { authorizationUrl: f('authorizationUrl') } : {}),
    ...(f('callbackUrl') ? { redirectUri: f('callbackUrl') } : {}),
    ...(clientSecret ? { clientSecret } : {}),
    ...(looksSecret('clientSecret', clientSecret) ? { clientSecretIsSecret: true } : {}),
    ...(f('username') ? { username: f('username') } : {}),
    ...(password ? { password } : {}),
    ...(looksSecret('password', password) ? { passwordIsSecret: true } : {}),
    ...(f('scope') ? { scope: f('scope') } : {}),
    ...(placement === 'basic_auth_header'
      ? { clientAuthMethod: 'basic_header' as const }
      : placement === 'body'
        ? { clientAuthMethod: 'request_body' as const }
        : {}),
    ...(f('tokenHeaderPrefix') ? { tokenHeaderPrefix: f('tokenHeaderPrefix') } : {}),
    ...(grantType === 'authorization_code_pkce' ? { pkceCodeChallengeMethod: 'S256' as const } : {}),
    ...(autoRefresh === true || autoRefresh === 'true' ? { autoRefresh: true } : {}),
  };
  return { type: 'oauth2', oauth2 };
}

/** Converts a Bruno auth object (`{ mode, <mode>: {...} }`); `undefined` means inherit. */
function convertAuth(raw: unknown, label: string, warnings: WarningCollector): AuthConfig | undefined {
  if (!isObject(raw)) return undefined;
  const mode = str(raw, 'mode').toLowerCase();
  const cfg = raw[mode];
  const f = (key: string) => str(cfg, key);

  switch (mode) {
    case '':
    case 'inherit':
      return undefined;
    case 'none':
      return { type: 'none' };
    case 'basic':
      return {
        type: 'basic',
        basic: {
          username: f('username'),
          password: f('password'),
          ...(looksSecret('password', f('password')) ? { secret: true } : {}),
        },
      };
    case 'bearer':
      return {
        type: 'bearer',
        bearer: {
          token: f('token'),
          prefix: 'Bearer',
          ...(looksSecret('token', f('token')) ? { secret: true } : {}),
        },
      };
    case 'apikey':
      return {
        type: 'apikey',
        apikey: {
          key: f('key') || 'X-API-Key',
          value: f('value'),
          in: f('placement') === 'queryparams' ? 'query' : 'header',
          ...(looksSecret('apiKey', f('value')) ? { secret: true } : {}),
        },
      };
    case 'digest':
      return {
        type: 'digest',
        digest: {
          username: f('username'),
          password: f('password'),
          ...(looksSecret('password', f('password')) ? { secret: true } : {}),
        },
      };
    case 'awsv4':
      if (f('profileName')) {
        warnings.addFor('AWS profile names are not supported; set the access keys instead', label);
      }
      return {
        type: 'awsv4',
        awsv4: {
          accessKeyId: f('accessKeyId'),
          secretAccessKey: f('secretAccessKey'),
          ...(f('sessionToken') ? { sessionToken: f('sessionToken') } : {}),
          region: f('region'),
          service: f('service'),
          ...(looksSecret('secretAccessKey', f('secretAccessKey')) ? { secret: true } : {}),
        },
      };
    case 'oauth2':
      return convertOAuth2(cfg, label, warnings);
    default:
      warnings.addFor(`Auth type "${mode}" is not supported and was set to No Auth`, label);
      return { type: 'none' };
  }
}

type ResponseRef =
  | { kind: 'status' }
  | { kind: 'responseTime' }
  | { kind: 'body' }
  | { kind: 'jsonpath'; path: string }
  | { kind: 'header'; name: string };

/** Parses `res.status`, `res.body.a[0]`, `res.headers['x']`, `res("a.b")`, and friends. */
function parseResponseRef(expression: string): ResponseRef | null {
  const expr = expression.trim();
  if (/^res\.(?:status|getStatus\(\))$/.test(expr)) return { kind: 'status' };
  if (/^res\.(?:responseTime|getResponseTime\(\))$/.test(expr)) return { kind: 'responseTime' };

  const header =
    /^res\.headers\.([\w-]+)$/.exec(expr) ??
    /^res\.headers\[\s*['"]([^'"]+)['"]\s*\]$/.exec(expr) ??
    /^res\.getHeader\(\s*['"]([^'"]+)['"]\s*\)$/.exec(expr);
  if (header) return { kind: 'header', name: header[1] };

  const query = /^res\(\s*['"]([^'"]+)['"]\s*\)$/.exec(expr);
  if (query) {
    const path = query[1];
    return { kind: 'jsonpath', path: path.startsWith('[') ? `$${path}` : `$.${path}` };
  }

  const body = /^res\.(?:body|getBody\(\))((?:\.[A-Za-z_$][\w$-]*|\[\d+\]|\[(?:'[^']*'|"[^"]*")\])*)$/.exec(expr);
  if (body) return body[1] ? { kind: 'jsonpath', path: toJsonPath(body[1]) } : { kind: 'body' };
  return null;
}

const ASSERT_OPERATORS: Record<string, AssertionOperator> = {
  eq: 'equals',
  neq: 'notEquals',
  gt: 'greaterThan',
  lt: 'lessThan',
  in: 'in',
  contains: 'contains',
  notContains: 'notContains',
  matches: 'matchesRegex',
  isEmpty: 'isEmpty',
  isNotEmpty: 'isNotEmpty',
  isDefined: 'isDefined',
  isUndefined: 'isUndefined',
  isArray: 'isArray',
};

const KNOWN_BRUNO_OPERATORS = new Set([
  ...Object.keys(ASSERT_OPERATORS),
  'gte',
  'lte',
  'notIn',
  'length',
  'notMatches',
  'startsWith',
  'endsWith',
  'between',
  'isNull',
  'isTruthy',
  'isFalsy',
  'isJson',
  'isNumber',
  'isString',
  'isBoolean',
]);

function parseExpected(raw: string): string | number | boolean {
  const value = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true' || value === 'false') return value === 'true';
  const quoted = /^(['"])(.*)\1$/.exec(value);
  return quoted ? quoted[2] : value;
}

function convertAssertions(raw: unknown, label: string, warnings: WarningCollector): AssertionRule[] {
  const rules: AssertionRule[] = [];
  for (const row of list(raw)) {
    const ref = parseResponseRef(str(row, 'name'));
    const value = str(row, 'value').trim();
    const opToken = value.split(/\s+/, 1)[0];
    const [op, arg] = KNOWN_BRUNO_OPERATORS.has(opToken)
      ? [opToken, value.slice(opToken.length).trim()]
      : ['eq', value];
    const operator = ASSERT_OPERATORS[op];
    if (!ref || !operator) {
      warnings.addFor(
        !ref ? 'Assertions on custom expressions were not imported' : `Assertions using "${op}" were not imported`,
        label,
      );
      continue;
    }

    const expected =
      operator === 'in'
        ? arg
            .replace(/^\[|\]$/g, '')
            .split(',')
            .map(v => parseExpected(v))
            .filter((v): v is string | number => typeof v !== 'boolean')
        : arg
          ? parseExpected(arg)
          : undefined;
    const target: Pick<AssertionRule, 'target' | 'path' | 'headerName'> =
      ref.kind === 'jsonpath'
        ? { target: 'jsonpath', path: ref.path }
        : ref.kind === 'header'
          ? { target: 'header', headerName: ref.name }
          : { target: ref.kind };
    rules.push({
      ...target,
      operator,
      ...(expected !== undefined ? { expected } : {}),
      enabled: row.enabled !== false,
    });
  }
  return rules;
}

/** `vars:post-response { token: res.body.token }` → captures (runtime variables, like Bruno). */
function convertPostResponseVars(raw: unknown, label: string, warnings: WarningCollector): CaptureRule[] {
  const captures: CaptureRule[] = [];
  for (const row of list(raw)) {
    const variable = str(row, 'name');
    if (!variable) continue;
    const ref = parseResponseRef(str(row, 'value'));
    const enabled = row.enabled !== false;
    if (ref?.kind === 'jsonpath') {
      captures.push({ variable, scope: 'runtime', source: 'jsonpath', expression: ref.path, enabled });
    } else if (ref?.kind === 'body') {
      captures.push({ variable, scope: 'runtime', source: 'body', enabled });
    } else if (ref?.kind === 'header') {
      captures.push({ variable, scope: 'runtime', source: 'header', expression: ref.name, enabled });
    } else if (ref?.kind === 'status') {
      captures.push({ variable, scope: 'runtime', source: 'status', enabled });
    } else {
      warnings.addFor('Post-response variables with custom expressions were not imported', label);
    }
  }
  return captures;
}

const BRUNO_SCRIPT_DIALECT: ScriptDialect = {
  statusPatterns: [
    /expect\(\s*res\.(?:status|getStatus\(\))\s*\)\.to\.(?:eql|equal|be\.equal)\(\s*(\d{3})\s*\)/g,
    /expect\(\s*res\s*\)\.to\.have\.status\(\s*(\d{3})\s*\)/g,
  ],
  bodySources: [String.raw`res\.getBody\(\)`, String.raw`res\.body`],
  headerReads: [
    String.raw`res\.getHeader\(\s*['"]([^'"]+)['"]\s*\)`,
    String.raw`res\.headers\[\s*['"]([^'"]+)['"]\s*\]`,
  ],
  setter: String.raw`bru\.(setEnvVar|setVar|setGlobalEnvVar)`,
  setterScopes: { setEnvVar: 'environment', setVar: 'runtime', setGlobalEnvVar: 'collection' },
  testWrapper: /test\(\s*(['"`])[^'"`]*\1\s*,\s*(?:async\s+)?(?:function\s*\(\s*\)|\(\s*\)\s*=>)\s*\{/g,
};

/** Converts Bruno post-response / test script idioms (`bru.setEnvVar`, `expect(res.status)`). */
export function convertBrunoScript(script: string): ConvertedScript {
  return convertTestScript(script, BRUNO_SCRIPT_DIALECT);
}

function convertBody(
  raw: unknown,
  label: string,
  warnings: WarningCollector,
): RequestBodyConfig {
  const mode = str(raw, 'mode');
  const content = (key: string): string => str(raw, key);
  switch (mode) {
    case 'json':
      return content('json') ? { mode: 'json', content: content('json') } : { mode: 'none' };
    case 'text':
      return content('text') ? { mode: 'text', content: content('text') } : { mode: 'none' };
    case 'xml':
      return content('xml') ? { mode: 'xml', content: content('xml') } : { mode: 'none' };
    case 'sparql':
      warnings.addFor('SPARQL bodies were imported as plain text', label);
      return { mode: 'text', content: content('sparql') };
    case 'formUrlEncoded':
      return { mode: 'form-urlencoded', urlEncoded: convertKeyValues(isObject(raw) ? raw.formUrlEncoded : [], false) };
    case 'multipartForm': {
      const formData: FormDataEntry[] = [];
      for (const row of list(isObject(raw) ? raw.multipartForm : [])) {
        const key = str(row, 'name');
        if (!key) continue;
        const contentType = text(row.contentType);
        const common = { key, enabled: row.enabled !== false, ...(contentType ? { contentType } : {}) };
        if (row.type === 'file') {
          const files = Array.isArray(row.value) ? row.value.map(v => asString(v) ?? '') : [str(row, 'value')];
          if (files.length > 1) warnings.addFor('Only the first file of multi-file form fields was kept', label);
          if (files[0]) warnings.addFor('File paths are relative to the Bruno collection folder; check them', label);
          formData.push({ ...common, type: 'file', filePath: files[0] ?? '' });
        } else {
          formData.push({ ...common, type: 'text', value: str(row, 'value') });
        }
      }
      return { mode: 'multipart-form', formData };
    }
    case 'file': {
      const files = list(isObject(raw) ? raw.file : []);
      const chosen = files.find(f => f.selected !== false) ?? files[0];
      const filePath = str(chosen, 'filePath');
      const contentType = text(chosen?.contentType);
      if (filePath) warnings.addFor('File paths are relative to the Bruno collection folder; check them', label);
      return {
        mode: 'binary',
        ...(filePath ? { binaryFilePath: filePath } : {}),
        ...(contentType ? { contentType } : {}),
      };
    }
    case '':
    case 'none':
    case 'graphql':
      return { mode: 'none' };
    default:
      warnings.addFor(`Body mode "${mode}" is not supported and was dropped`, label);
      return { mode: 'none' };
  }
}

function reportRootScripts(root: unknown, label: string, ctx: ConvertContext, level: string): void {
  const request = isObject(root) ? root.request : undefined;
  const script = isObject(request) ? request.script : undefined;
  if (text(str(script, 'req')) || text(str(script, 'res')) || text(isObject(request) ? request.tests : undefined)) {
    ctx.warnings.addFor(`${level} scripts were not imported`, label);
  }
}

function convertRequest(item: AnyRecord, ctx: ConvertContext): RequestItem {
  const name = text(item.name) ?? 'Untitled Request';
  const req = isObject(item.request) ? item.request : {};
  const params = list(req.params);
  const url = str(req, 'url');

  const queryRows = params.filter(p => p.type !== 'path');
  const queryParams: QueryParamEntry[] =
    queryRows.length > 0 ? convertKeyValues(queryRows, false) : syncQueryParamsFromUrl(url, []);
  const declaredPath = new Map(
    params.filter(p => p.type === 'path').map(p => [str(p, 'name'), str(p, 'value')] as const),
  );
  const pathParams: PathParamEntry[] = extractPathParamNames(url).map(key => ({
    key,
    value: declaredPath.get(key) ?? '',
  }));

  const headers = convertKeyValues(req.headers, true);
  const auth = convertAuth(req.auth, name, ctx.warnings) ?? { type: 'inherit' };
  const description = text(req.docs);

  const script = isObject(req.script) ? req.script : {};
  if (text(script.req)) ctx.warnings.addFor('Pre-request scripts were not imported', name);
  const vars = isObject(req.vars) ? req.vars : {};
  if (list(vars.req).length > 0) ctx.warnings.addFor('Request variables were not imported', name);

  const assertions = convertAssertions(req.assertions, name, ctx.warnings);
  const captures = convertPostResponseVars(vars.res, name, ctx.warnings);
  for (const [source, kind] of [
    [asString(script.res) ?? '', 'Post-response scripts'],
    [asString(req.tests) ?? '', 'Tests'],
  ] as const) {
    const converted = convertBrunoScript(source.trim());
    assertions.push(...converted.assertions);
    captures.push(...converted.captures);
    if (!converted.fullyConverted) {
      ctx.warnings.addFor(
        converted.assertions.length + converted.captures.length > 0
          ? `${kind} were partly converted to assertions/captures; review them`
          : `${kind} were not imported`,
        name,
      );
    }
  }

  const common = {
    name,
    method: (str(req, 'method') || 'GET').toUpperCase(),
    url,
    queryParams,
    pathParams,
    auth,
    assertions,
    captures,
    ...(description ? { description } : {}),
  };

  const body = isObject(req.body) ? req.body : {};
  if (item.type === 'graphql-request' || body.mode === 'graphql') {
    const gql = isObject(body.graphql) ? body.graphql : {};
    const hasContentType = headers.some(h => h.key.toLowerCase() === 'content-type');
    return createDefaultGraphQLRequest({
      ...common,
      headers: hasContentType
        ? headers
        : [{ key: 'Content-Type', value: 'application/json', enabled: true }, ...headers],
      graphql: {
        operationName: '',
        query: str(gql, 'query'),
        variables: text(gql.variables) ?? '{\n}\n',
        schemaSource: { mode: 'introspect', autoIntrospectOnOpen: false, localSchemaPath: '' },
      },
    });
  }
  return createDefaultHttpRequest({ ...common, headers, body: convertBody(body, name, ctx.warnings) });
}

function convertItems(raw: unknown, ctx: ConvertContext): CollectionTreeItem[] {
  const items: CollectionTreeItem[] = [];
  for (const item of list(raw)) {
    if (item.type === 'folder') {
      const name = text(item.name) ?? 'Untitled Folder';
      const root = isObject(item.root) ? item.root : {};
      const request = isObject(root.request) ? root.request : {};
      reportRootScripts(root, name, ctx, 'Folder');
      const variables = convertVariables(isObject(request.vars) ? request.vars.req : []);
      const headers = convertKeyValues(request.headers, true);
      const description = text(root.docs);
      items.push(
        createDefaultFolder(name, convertItems(item.items, ctx), {
          ...(description ? { description } : {}),
          auth: convertAuth(request.auth, name, ctx.warnings) ?? { type: 'inherit' },
          headers,
          ...(variables.length > 0 ? { variables } : {}),
        }),
      );
    } else if (item.type === 'http-request' || item.type === 'graphql-request') {
      items.push(convertRequest(item, ctx));
    }
  }
  return items;
}

/** Converts a collection in Bruno's JSON export shape (also produced by `parseBrunoCollectionFiles`). */
function convertBrunoCollection(doc: AnyRecord): CollectionImportResult {
  const warnings = new WarningCollector();
  const ctx: ConvertContext = { warnings };
  const name = text(doc.name) ?? 'Imported Bruno Collection';
  const root = isObject(doc.root) ? doc.root : {};
  const rootRequest = isObject(root.request) ? root.request : {};
  const description = text(root.docs);

  const rootScript = isObject(rootRequest.script) ? rootRequest.script : {};
  if (text(rootScript.req) || text(rootScript.res) || text(rootRequest.tests)) {
    warnings.add('Collection-level scripts were not imported.');
  }

  const environments: EnvironmentConfig[] = list(doc.environments).map((env, idx) => ({
    id: generateAwjcId('env'),
    name: text(env.name) ?? `Environment ${idx + 1}`,
    color: ENVIRONMENT_COLORS[idx % ENVIRONMENT_COLORS.length],
    variables: convertVariables(env.variables),
  }));
  const defaultHeaders = convertKeyValues(rootRequest.headers, true);
  const defaultAuth = convertAuth(rootRequest.auth, name, warnings) ?? { type: 'none' };
  const variables = convertVariables(isObject(rootRequest.vars) ? rootRequest.vars.req : []);
  const items = convertItems(doc.items, ctx);

  const unsupported = new Set<string>();
  const collection = mapDynamicVariables<AwjcCollection>(
    {
      awapiLasso: AWJC_SCHEMA_VERSION,
      kind: 'Collection',
      metadata: {
        id: generateAwjcId('col'),
        name,
        ...(description ? { description } : {}),
      },
      defaults: {
        timeoutMs: 30000,
        followRedirects: true,
        verifySsl: true,
        ...(defaultHeaders.length > 0 ? { headers: defaultHeaders } : {}),
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
      `Dynamic variables without an AwapiLasso equivalent were left as-is: ${Array.from(unsupported).sort().join(', ')}.`,
    );
  }
  if (JSON.stringify(collection).includes('{{process.env.')) {
    warnings.add('{{process.env.*}} variables (from the Bruno .env file) were left as-is; define them as variables.');
  }

  return { collection, warnings: warnings.list() };
}

/** Imports a Bruno collection folder (`bruno.json`, `collection.bru`, `**\/*.bru`, `environments/*.bru`). */
export function importBrunoCollectionFiles(files: BrunoSourceFile[]): CollectionImportResult {
  return convertBrunoCollection(parseBrunoCollectionFiles(files));
}

/** Imports a collection exported from Bruno as JSON (Collection → Share/Export → Bruno Collection). */
export function importBrunoExport(input: string | AnyRecord): CollectionImportResult {
  let doc: unknown = input;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input) as unknown;
    } catch (err) {
      throw new Error(`Bruno export is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (isObject(doc) && isObject(doc.info) && Array.isArray(doc.item)) {
    throw new Error('This looks like a Postman collection. Use Import from Postman instead.');
  }
  if (!isObject(doc) || !Array.isArray(doc.items)) {
    throw new Error('Not a Bruno collection export: expected "name" and "items" fields');
  }
  return convertBrunoCollection(doc);
}
