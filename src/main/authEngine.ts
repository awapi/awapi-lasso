import * as crypto from 'crypto';
import type {
  AuthConfig,
  AuthProfile,
  AwjcCollection,
  CollectionTreeItem,
  DigestAuthConfig,
  FolderItem,
  KeyValueEntry,
  RequestItem,
  VariableEntry,
} from '../shared/collectionSchema';
import { interpolateText, type VariableInterpolationContext } from '../shared/interpolation';

export interface ResolvedAuthResult {
  config: AuthConfig;
  /** ID of the request, folder, collection, or authProfile where the effective auth originated. */
  sourceOwnerId?: string;
}

export interface ResolveEffectiveAuthOptions {
  requestAuth?: AuthConfig;
  requestOwnerId?: string;
  /**
   * Ordered from nearest parent folder to outermost ancestor folder.
   */
  ancestorAuthChain?: Array<{ auth?: AuthConfig; ownerId?: string } | AuthConfig | undefined>;
  collectionDefaultAuth?: AuthConfig;
  collectionId?: string;
  authProfiles?: AuthProfile[];
}

export interface RequestHierarchyContext {
  request: RequestItem;
  /** Ordered from outermost folder to innermost folder. */
  ancestorFolders: FolderItem[];
  /** Merged enabled headers from collection defaults -> outermost folder -> innermost folder. */
  inheritedHeaders: KeyValueEntry[];
  /** Folder variable lists ordered from outermost folder to innermost folder. */
  folderVariablesChain: VariableEntry[][];
  /** Effective auth resolved across Request -> Innermost Folder -> Outermost Folder -> Collection Defaults -> AuthProfile. */
  effectiveAuth: ResolvedAuthResult;
}

function normalizeChainEntry(
  entry: { auth?: AuthConfig; ownerId?: string } | AuthConfig | undefined,
): { auth?: AuthConfig; ownerId?: string } {
  if (!entry) return {};
  if ('type' in entry) {
    return { auth: entry };
  }
  return entry;
}

function dereferenceAuthProfile(
  auth: AuthConfig,
  ownerId: string | undefined,
  authProfiles: AuthProfile[] = [],
): ResolvedAuthResult {
  if (auth.type !== 'profile') {
    return { config: auth, sourceOwnerId: ownerId };
  }

  const targetId = auth.profileId?.trim();
  if (!targetId) {
    return { config: { type: 'none' }, sourceOwnerId: ownerId };
  }

  const matched = authProfiles.find(p => p.id === targetId || p.name === targetId);
  if (!matched) {
    return { config: { type: 'none' }, sourceOwnerId: ownerId };
  }

  return {
    config: matched,
    sourceOwnerId: matched.id,
  };
}

/**
 * Resolves effective authentication by walking:
 * `Request -> Ancestor Folders (nearest to outermost) -> Collection Defaults -> Named Auth Profile (authProfiles)`.
 */
export function resolveEffectiveAuth(options: ResolveEffectiveAuthOptions): ResolvedAuthResult {
  const {
    requestAuth,
    requestOwnerId,
    ancestorAuthChain = [],
    collectionDefaultAuth,
    collectionId,
    authProfiles = [],
  } = options;

  const candidates: Array<{ auth?: AuthConfig; ownerId?: string }> = [
    { auth: requestAuth, ownerId: requestOwnerId },
    ...ancestorAuthChain.map(normalizeChainEntry),
    { auth: collectionDefaultAuth, ownerId: collectionId },
  ];

  for (const candidate of candidates) {
    const auth = candidate.auth;
    if (!auth || auth.type === 'inherit') {
      continue;
    }
    if (auth.type === 'none') {
      return { config: { type: 'none' }, sourceOwnerId: candidate.ownerId };
    }
    return dereferenceAuthProfile(auth, candidate.ownerId, authProfiles);
  }

  return { config: { type: 'none' }, sourceOwnerId: collectionId };
}

function findRequestInTree(
  items: CollectionTreeItem[],
  requestId: string,
  ancestors: FolderItem[],
): { request: RequestItem; ancestors: FolderItem[] } | null {
  for (const item of items) {
    if (item.kind === 'request' && item.id === requestId) {
      return { request: item, ancestors };
    }
    if (item.kind === 'folder') {
      const found = findRequestInTree(item.items, requestId, [...ancestors, item]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Locates a request inside an `AwjcCollection` and resolves its full inheritance chain
 * (ancestor folders, inherited headers, folder variables chain, and effective auth).
 */
export function resolveRequestHierarchyInCollection(
  collection: AwjcCollection,
  requestId: string,
): RequestHierarchyContext | null {
  const located = findRequestInTree(collection.items, requestId, []);
  if (!located) return null;

  const { request, ancestors } = located;

  // Inherited headers cascade from Collection Defaults -> Outermost Folder -> Innermost Folder
  const headerMap = new Map<string, KeyValueEntry>();
  const applyHeaders = (list: KeyValueEntry[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const h of list) {
      if (!h || h.enabled === false || !h.key.trim()) continue;
      headerMap.set(h.key.trim().toLowerCase(), { ...h });
    }
  };

  applyHeaders(collection.defaults?.headers);
  for (const folder of ancestors) {
    applyHeaders(folder.headers);
  }

  const folderVariablesChain = ancestors
    .map(f => f.variables ?? [])
    .filter(vars => vars.length > 0);

  // Auth walks from Request -> Innermost Folder -> Outermost Folder -> Collection Defaults
  const nearestFirstFolders = [...ancestors].reverse().map(f => ({
    auth: f.auth,
    ownerId: f.id,
  }));

  const effectiveAuth = resolveEffectiveAuth({
    requestAuth: request.auth,
    requestOwnerId: request.id,
    ancestorAuthChain: nearestFirstFolders,
    collectionDefaultAuth: collection.defaults?.auth,
    collectionId: collection.metadata.id,
    authProfiles: collection.authProfiles ?? [],
  });

  return {
    request,
    ancestorFolders: ancestors,
    inheritedHeaders: Array.from(headerMap.values()),
    folderVariablesChain,
    effectiveAuth,
  };
}

export interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
  stale?: boolean;
}

/**
 * Parses a `WWW-Authenticate: Digest ...` challenge header into structured parameters.
 */
export function parseDigestChallenge(wwwAuthenticateHeader: string): DigestChallenge | null {
  if (!wwwAuthenticateHeader) return null;
  const trimmed = wwwAuthenticateHeader.trim();
  if (!/^Digest\s+/i.test(trimmed)) return null;

  const rest = trimmed.replace(/^Digest\s+/i, '');
  const params: Record<string, string> = {};

  const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rest)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] !== undefined ? match[2] : match[3];
    params[key] = val;
  }

  if (!params.nonce && !params.realm) {
    return null;
  }

  return {
    realm: params.realm ?? '',
    nonce: params.nonce ?? '',
    qop: params.qop,
    opaque: params.opaque,
    algorithm: params.algorithm,
    stale: params.stale?.toLowerCase() === 'true',
  };
}

function hashHex(algorithm: 'md5' | 'sha256', data: string): string {
  return crypto.createHash(algorithm).update(data, 'utf-8').digest('hex');
}

/**
 * Builds an RFC 2617 / RFC 7616 `Authorization: Digest ...` header value.
 */
export function buildDigestAuthorizationHeader(options: {
  config: DigestAuthConfig;
  method: string;
  requestUrl: string;
  challenge?: DigestChallenge;
  nc?: string;
  cnonce?: string;
  context?: VariableInterpolationContext;
}): string {
  const {
    config,
    method,
    requestUrl,
    challenge,
    nc = '00000001',
    cnonce = crypto.randomBytes(8).toString('hex'),
    context = {},
  } = options;

  const username = interpolateText(config.username ?? '', context);
  const password = interpolateText(config.password ?? '', context);
  const realm = challenge?.realm ?? interpolateText(config.realm ?? '', context);
  const nonce = challenge?.nonce ?? '';
  const rawAlgo = (challenge?.algorithm ?? 'MD5').toUpperCase();
  const isSha256 = rawAlgo.startsWith('SHA-256') || rawAlgo.startsWith('SHA256');
  const hashFn: 'md5' | 'sha256' = isSha256 ? 'sha256' : 'md5';
  const isSess = rawAlgo.endsWith('-SESS');

  let digestUri = '/';
  try {
    const parsedUrl = new URL(requestUrl);
    digestUri = `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`;
  } catch {
    digestUri = requestUrl;
  }

  let ha1 = hashHex(hashFn, `${username}:${realm}:${password}`);
  if (isSess) {
    ha1 = hashHex(hashFn, `${ha1}:${nonce}:${cnonce}`);
  }

  const ha2 = hashHex(hashFn, `${method.toUpperCase()}:${digestUri}`);

  const qopTokens = (challenge?.qop ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const selectedQop = qopTokens.includes('auth') ? 'auth' : qopTokens[0];

  const responseHash = selectedQop
    ? hashHex(hashFn, `${ha1}:${nonce}:${nc}:${cnonce}:${selectedQop}:${ha2}`)
    : hashHex(hashFn, `${ha1}:${nonce}:${ha2}`);

  const headerParts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${digestUri}"`,
    `algorithm=${rawAlgo}`,
    `response="${responseHash}"`,
  ];

  if (selectedQop) {
    headerParts.push(`qop=${selectedQop}`);
    headerParts.push(`nc=${nc}`);
    headerParts.push(`cnonce="${cnonce}"`);
  }

  if (challenge?.opaque !== undefined) {
    headerParts.push(`opaque="${challenge.opaque}"`);
  }

  return `Digest ${headerParts.join(', ')}`;
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf-8').digest();
}

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export interface AwsV4SignInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: Buffer | string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
  /** Optional ISO or `YYYYMMDDTHHMMSSZ` timestamp for deterministic tests. */
  amzDate?: string;
}

/**
 * Computes AWS Signature Version 4 headers (`Authorization`, `x-amz-date`, `x-amz-content-sha256`,
 * and optional `x-amz-security-token`).
 */
export function signAwsV4Request(input: AwsV4SignInput): Record<string, string> {
  const parsedUrl = new URL(input.url);
  const amzDate =
    input.amzDate ??
    new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
  const dateStamp = amzDate.slice(0, 8);

  const payloadBuf =
    input.body === undefined
      ? Buffer.alloc(0)
      : typeof input.body === 'string'
        ? Buffer.from(input.body, 'utf-8')
        : input.body;
  const payloadHash = sha256Hex(payloadBuf);

  const signedHeaderMap: Record<string, string> = {
    host: parsedUrl.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (input.sessionToken) {
    signedHeaderMap['x-amz-security-token'] = input.sessionToken;
  }

  if (input.headers) {
    for (const [k, v] of Object.entries(input.headers)) {
      const lower = k.toLowerCase();
      if (lower === 'content-type' || lower.startsWith('x-amz-')) {
        signedHeaderMap[lower] = v.trim().replace(/\s+/g, ' ');
      }
    }
  }

  const sortedHeaderKeys = Object.keys(signedHeaderMap).sort();
  const canonicalHeaders = sortedHeaderKeys
    .map(k => `${k}:${signedHeaderMap[k]}\n`)
    .join('');
  const signedHeadersList = sortedHeaderKeys.join(';');

  // Canonical URI
  const canonicalUri =
    parsedUrl.pathname
      .split('/')
      .map(seg => encodeRfc3986(decodeURIComponent(seg)))
      .join('/') || '/';

  // Canonical Query String (sorted by encoded key, then encoded value)
  const queryEntries: Array<[string, string]> = [];
  parsedUrl.searchParams.forEach((val, key) => {
    queryEntries.push([encodeRfc3986(key), encodeRfc3986(val)]);
  });
  queryEntries.sort((a, b) => {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
  });
  const canonicalQueryString = queryEntries.map(([k, v]) => `${k}=${v}`).join('&');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, input.region);
  const kService = hmacSha256(kRegion, input.service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign, 'utf-8')
    .digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  const outHeaders: Record<string, string> = {
    Authorization: authorization,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
  if (input.sessionToken) {
    outHeaders['x-amz-security-token'] = input.sessionToken;
  }

  return outHeaders;
}

export interface InjectRequestAuthOptions {
  auth?: AuthConfig;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer | string;
  context?: VariableInterpolationContext;
  /** Optional OAuth 2.0 access token already resolved by `oauth2Engine`. */
  oauth2AccessToken?: string;
  /** Optional Digest challenge from a 401 response. */
  digestChallenge?: DigestChallenge;
  /** Optional fixed `amzDate` for deterministic AWSv4 unit tests. */
  awsAmzDate?: string;
}

export interface InjectedRequestAuthResult {
  url: string;
  headers: Record<string, string>;
}

function appendQueryParamToUrl(rawUrl: string, key: string, value: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set(key, value);
    return parsed.toString();
  } catch {
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

function hasHeaderCaseInsensitive(headers: Record<string, string>, targetKey: string): boolean {
  const lower = targetKey.toLowerCase();
  return Object.keys(headers).some(k => k.toLowerCase() === lower);
}

/**
 * Injects the resolved authentication scheme (`bearer`, `basic`, `apikey`, `digest`, `awsv4`, `oauth2`)
 * into the outbound request URL and headers after `{{variable}}` interpolation.
 */
export function injectRequestAuth(options: InjectRequestAuthOptions): InjectedRequestAuthResult {
  const { auth, method, url, headers, body, context = {} } = options;
  const nextHeaders: Record<string, string> = { ...headers };
  let nextUrl = url;

  if (!auth || auth.type === 'none' || auth.type === 'inherit') {
    return { url: nextUrl, headers: nextHeaders };
  }

  switch (auth.type) {
    case 'bearer': {
      const bearer = auth.bearer;
      if (!bearer) break;
      const token = interpolateText(bearer.token ?? '', context).trim();
      if (!token) break;
      const prefix =
        bearer.prefix !== undefined
          ? interpolateText(bearer.prefix, context).trim()
          : 'Bearer';
      if (!hasHeaderCaseInsensitive(nextHeaders, 'Authorization')) {
        nextHeaders.Authorization = prefix ? `${prefix} ${token}` : token;
      }
      break;
    }

    case 'basic': {
      const basic = auth.basic;
      if (!basic) break;
      const username = interpolateText(basic.username ?? '', context);
      const password = interpolateText(basic.password ?? '', context);
      const encoded = Buffer.from(`${username}:${password}`, 'utf-8').toString('base64');
      if (!hasHeaderCaseInsensitive(nextHeaders, 'Authorization')) {
        nextHeaders.Authorization = `Basic ${encoded}`;
      }
      break;
    }

    case 'apikey': {
      const apikey = auth.apikey;
      if (!apikey) break;
      const key = interpolateText(apikey.key ?? '', context).trim();
      const val = interpolateText(apikey.value ?? '', context);
      if (!key) break;
      if (apikey.in === 'query') {
        nextUrl = appendQueryParamToUrl(nextUrl, key, val);
      } else {
        if (!hasHeaderCaseInsensitive(nextHeaders, key)) {
          nextHeaders[key] = val;
        }
      }
      break;
    }

    case 'digest': {
      const digest = auth.digest;
      if (!digest) break;
      // Inject Digest Authorization if either a 401 challenge was received or a static realm is provided
      if (options.digestChallenge || digest.realm) {
        nextHeaders.Authorization = buildDigestAuthorizationHeader({
          config: digest,
          method,
          requestUrl: nextUrl,
          challenge: options.digestChallenge,
          context,
        });
      }
      break;
    }

    case 'awsv4': {
      const awsv4 = auth.awsv4;
      if (!awsv4) break;
      const accessKeyId = interpolateText(awsv4.accessKeyId ?? '', context);
      const secretAccessKey = interpolateText(awsv4.secretAccessKey ?? '', context);
      const sessionToken = awsv4.sessionToken
        ? interpolateText(awsv4.sessionToken, context)
        : undefined;
      const region = interpolateText(awsv4.region || 'us-east-1', context);
      const service = interpolateText(awsv4.service || 'execute-api', context);

      if (accessKeyId && secretAccessKey) {
        const signed = signAwsV4Request({
          method,
          url: nextUrl,
          headers: nextHeaders,
          body,
          accessKeyId,
          secretAccessKey,
          sessionToken,
          region,
          service,
          amzDate: options.awsAmzDate,
        });
        Object.assign(nextHeaders, signed);
      }
      break;
    }

    case 'oauth2': {
      const token = options.oauth2AccessToken?.trim();
      if (token && !hasHeaderCaseInsensitive(nextHeaders, 'Authorization')) {
        const prefix =
          auth.oauth2?.tokenHeaderPrefix !== undefined
            ? interpolateText(auth.oauth2.tokenHeaderPrefix, context).trim()
            : 'Bearer';
        nextHeaders.Authorization = prefix ? `${prefix} ${token}` : token;
      }
      break;
    }
  }

  return { url: nextUrl, headers: nextHeaders };
}
