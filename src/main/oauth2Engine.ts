import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';
import type { OAuth2Config } from '../shared/collectionSchema';
import { interpolateText, type VariableInterpolationContext } from '../shared/interpolation';
import type {
  DecodedJwtToken,
  OAuth2GetTokenRequest,
  OAuth2RefreshTokenRequest,
  OAuth2TokenCoordinate,
  OAuth2TokenExchangeResult,
  OAuth2TokenRecord,
} from '../shared/oauth2Types';
import {
  deleteSecret,
  getSecret,
  setSecret,
  type SecretCoordinate,
  type SecretStoreDeps,
} from './secretStore';

export const TOKEN_EXPIRY_BUFFER_SECONDS = 30;

const memoryTokenCache = new Map<string, OAuth2TokenRecord>();

export interface OAuth2EngineDeps {
  secretDeps?: SecretStoreDeps;
  /** Opens the system browser to the OAuth2 authorization URL during `authorization_code` flows. */
  openExternalUrl?: (url: string) => Promise<void> | void;
  /**
   * Optional custom authorization code provider (used when testing or overriding the loopback server).
   */
  authorizeCodeProvider?: (params: {
    authorizationUrl: string;
    redirectUri: string;
    state: string;
    codeVerifier?: string;
    codeChallenge?: string;
    codeChallengeMethod?: 'S256' | 'plain';
  }) => Promise<{ code: string; state?: string }>;
  now?: () => number;
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecodeToString(segment: string): string {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLen);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

/**
 * Generates an RFC 7636 PKCE `code_verifier` and `code_challenge` pair (`S256` or `plain`).
 */
export function generatePkcePair(
  method: 'S256' | 'plain' = 'S256',
  customVerifier?: string,
): {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256' | 'plain';
} {
  const codeVerifier = customVerifier ?? base64UrlEncode(crypto.randomBytes(32));
  if (method === 'plain') {
    return {
      codeVerifier,
      codeChallenge: codeVerifier,
      codeChallengeMethod: 'plain',
    };
  }
  const sha256 = crypto.createHash('sha256').update(codeVerifier, 'ascii').digest();
  return {
    codeVerifier,
    codeChallenge: base64UrlEncode(sha256),
    codeChallengeMethod: 'S256',
  };
}

/**
 * Safely decodes a JWT (`header.payload.signature`) without verifying the cryptographic signature,
 * extracting standard claims (`exp`, `iat`, `sub`, `iss`, `aud`, `scp`/`scope`) and expiration state.
 */
export function decodeJwtToken(token: string, nowMs: number = Date.now()): DecodedJwtToken {
  if (!token || typeof token !== 'string') {
    return {
      isJwt: false,
      header: null,
      payload: null,
      error: 'Empty token string',
    };
  }

  const trimmed = token.trim().replace(/^Bearer\s+/i, '');
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    return {
      isJwt: false,
      header: null,
      payload: null,
      error: 'Token does not have 3 JWT segments (header.payload.signature)',
    };
  }

  try {
    const headerJson = base64UrlDecodeToString(parts[0]);
    const payloadJson = base64UrlDecodeToString(parts[1]);

    const header = JSON.parse(headerJson) as Record<string, unknown>;
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    if (
      !header ||
      typeof header !== 'object' ||
      Array.isArray(header) ||
      !payload ||
      typeof payload !== 'object' ||
      Array.isArray(payload)
    ) {
      return {
        isJwt: false,
        header: null,
        payload: null,
        error: 'Decoded JWT segments are not JSON objects',
      };
    }

    let issuedAt: string | undefined;
    if (typeof payload.iat === 'number') {
      issuedAt = new Date(payload.iat * 1000).toISOString();
    }

    let expiresAt: string | undefined;
    let isExpired: boolean | undefined;
    let expiresInSeconds: number | undefined;
    if (typeof payload.exp === 'number') {
      const expMs = payload.exp * 1000;
      expiresAt = new Date(expMs).toISOString();
      expiresInSeconds = Math.floor((expMs - nowMs) / 1000);
      isExpired = expMs <= nowMs;
    }

    const subject = typeof payload.sub === 'string' ? payload.sub : undefined;
    const issuer = typeof payload.iss === 'string' ? payload.iss : undefined;
    const audience =
      typeof payload.aud === 'string' || Array.isArray(payload.aud)
        ? (payload.aud as string | string[])
        : undefined;

    let scopes: string[] | undefined;
    if (Array.isArray(payload.scp)) {
      scopes = payload.scp.map(String);
    } else if (typeof payload.scp === 'string') {
      scopes = payload.scp.split(/\s+/).filter(Boolean);
    } else if (Array.isArray(payload.scope)) {
      scopes = payload.scope.map(String);
    } else if (typeof payload.scope === 'string') {
      scopes = payload.scope.split(/\s+/).filter(Boolean);
    }

    return {
      isJwt: true,
      header,
      payload,
      signature: parts[2],
      issuedAt,
      expiresAt,
      isExpired,
      expiresInSeconds,
      subject,
      issuer,
      audience,
      scopes,
    };
  } catch (err) {
    return {
      isJwt: false,
      header: null,
      payload: null,
      error: err instanceof Error ? err.message : 'Failed to decode JWT',
    };
  }
}

export function buildTokenCacheKey(coord: OAuth2TokenCoordinate): string {
  const envId = coord.environmentId?.trim() || 'default';
  return `${coord.collectionId}::${envId}::${coord.profileOrRequestId}`;
}

function toSecretCoordinate(coord: OAuth2TokenCoordinate): SecretCoordinate {
  const envId = coord.environmentId?.trim() || 'default';
  return {
    collectionId: coord.collectionId,
    scopeId: `oauth2:${envId}`,
    key: `token:${coord.profileOrRequestId}`,
  };
}

/**
 * Stores an acquired OAuth 2.0 token in memory and (when `secretDeps` is provided) in the
 * OS Keychain-backed `secretStore` (`safeStorage`).
 */
export function cacheOAuth2Token(
  coord: OAuth2TokenCoordinate,
  token: OAuth2TokenRecord,
  deps: OAuth2EngineDeps = {},
): void {
  const key = buildTokenCacheKey(coord);
  memoryTokenCache.set(key, token);
  if (deps.secretDeps) {
    setSecret(toSecretCoordinate(coord), JSON.stringify(token), deps.secretDeps);
  }
}

/**
 * Retrieves a cached OAuth 2.0 token from memory or `secretStore` (`safeStorage`).
 */
export function getCachedOAuth2Token(
  coord: OAuth2TokenCoordinate,
  deps: OAuth2EngineDeps = {},
): OAuth2TokenRecord | null {
  const key = buildTokenCacheKey(coord);
  const inMem = memoryTokenCache.get(key);
  if (inMem) {
    return {
      ...inMem,
      decodedJwt: decodeJwtToken(inMem.accessToken, deps.now ? deps.now() : Date.now()),
    };
  }

  if (deps.secretDeps) {
    const raw = getSecret(toSecretCoordinate(coord), deps.secretDeps);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as OAuth2TokenRecord;
        if (parsed && typeof parsed.accessToken === 'string') {
          const hydrated: OAuth2TokenRecord = {
            ...parsed,
            decodedJwt: decodeJwtToken(parsed.accessToken, deps.now ? deps.now() : Date.now()),
          };
          memoryTokenCache.set(key, hydrated);
          return hydrated;
        }
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Clears a cached OAuth 2.0 token from memory and `secretStore` (`safeStorage`).
 */
export function clearCachedOAuth2Token(
  coord: OAuth2TokenCoordinate,
  deps: OAuth2EngineDeps = {},
): boolean {
  const key = buildTokenCacheKey(coord);
  const hadMem = memoryTokenCache.delete(key);
  let hadVault = false;
  if (deps.secretDeps) {
    hadVault = deleteSecret(toSecretCoordinate(coord), deps.secretDeps);
  }
  return hadMem || hadVault;
}

/**
 * Clears all in-memory cached OAuth 2.0 tokens (useful for test isolation).
 */
export function clearAllMemoryOAuth2Tokens(): void {
  memoryTokenCache.clear();
}

/**
 * Returns true if the token has an expiration timestamp (`expiresAt` or JWT `exp`)
 * that is already past or within `bufferSeconds` of expiring.
 */
export function isOAuth2TokenExpired(
  token: OAuth2TokenRecord,
  bufferSeconds: number = TOKEN_EXPIRY_BUFFER_SECONDS,
  nowMs: number = Date.now(),
): boolean {
  const expIso = token.expiresAt ?? token.decodedJwt?.expiresAt;
  if (!expIso) return false;
  const expMs = Date.parse(expIso);
  if (Number.isNaN(expMs)) return false;
  return expMs <= nowMs + bufferSeconds * 1000;
}

interface RawTokenHttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function postFormUrlEncoded(options: {
  url: string;
  formBody: string;
  headers: Record<string, string>;
  verifySsl?: boolean;
  timeoutMs?: number;
}): Promise<RawTokenHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.url);
    } catch (err) {
      reject(new Error(`Invalid OAuth 2.0 token URL: ${options.url}`));
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const bodyBuf = Buffer.from(options.formBody, 'utf-8');

    const reqHeaders: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': String(bodyBuf.byteLength),
      ...options.headers,
    };

    const reqOptions: https.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
      method: 'POST',
      headers: reqHeaders,
      ...(isHttps ? { rejectUnauthorized: options.verifySsl !== false } : {}),
    };

    const transport = isHttps ? https : http;
    const req = transport.request(reqOptions, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body,
        });
      });
    });

    const timeoutMs = options.timeoutMs ?? 30000;
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`OAuth 2.0 token request timed out after ${timeoutMs}ms`));
    });

    req.on('error', err => {
      reject(err);
    });

    req.write(bodyBuf);
    req.end();
  });
}

/**
 * Starts a temporary loopback HTTP server on `127.0.0.1` to capture the OAuth 2.0
 * authorization code redirect (`?code=...&state=...`).
 */
export async function listenForOAuth2LoopbackCallback(options: {
  redirectUri?: string;
  expectedState: string;
  onListening: (actualRedirectUri: string, authorizeUrlWithRedirect: string) => Promise<void> | void;
  buildAuthorizeUrl: (actualRedirectUri: string) => string;
  timeoutMs?: number;
}): Promise<{ code: string; state?: string; actualRedirectUri: string }> {
  let desiredPort = 0;
  let desiredPath = '/oauth2/callback';

  if (options.redirectUri) {
    try {
      const parsed = new URL(options.redirectUri);
      if (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') {
        desiredPort = parsed.port ? Number(parsed.port) : 0;
        desiredPath = parsed.pathname || '/callback';
      }
    } catch {
      // use ephemeral loopback port
    }
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let actualRedirectUri = '';

    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        const errorParam = reqUrl.searchParams.get('error');
        const errorDesc = reqUrl.searchParams.get('error_description');
        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state') ?? undefined;

        if (errorParam) {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            `<html><body><h2>OAuth 2.0 Authorization Failed</h2><p>${errorParam}: ${errorDesc ?? ''}</p></body></html>`,
          );
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            server.close();
            reject(
              new Error(
                `OAuth 2.0 authorization failed: ${errorParam}${errorDesc ? ` (${errorDesc})` : ''}`,
              ),
            );
          }
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Missing authorization code parameter.');
          return;
        }

        if (options.expectedState && state && state !== options.expectedState) {
          res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Invalid OAuth 2.0 state parameter.');
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            server.close();
            reject(new Error('OAuth 2.0 callback state mismatch'));
          }
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body><h2>Authentication complete</h2><p>You may close this window and return to AwapiLasso.</p></body></html>',
        );

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          server.close();
          resolve({ code, state, actualRedirectUri });
        }
      } catch (err) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          server.close();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    const timeoutMs = options.timeoutMs ?? 60000;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        server.close();
        reject(new Error(`Timed out waiting for OAuth 2.0 browser callback after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    server.on('error', err => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    server.listen(desiredPort, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : desiredPort;
      actualRedirectUri =
        options.redirectUri && desiredPort !== 0
          ? options.redirectUri
          : `http://127.0.0.1:${port}${desiredPath}`;
      const fullAuthUrl = options.buildAuthorizeUrl(actualRedirectUri);
      Promise.resolve(options.onListening(actualRedirectUri, fullAuthUrl)).catch(err => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          server.close();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  });
}

function interpolateExtraParams(
  extraParams: OAuth2Config['extraParams'],
  context: VariableInterpolationContext,
): Array<[string, string]> {
  if (!Array.isArray(extraParams)) return [];
  const pairs: Array<[string, string]> = [];
  for (const entry of extraParams) {
    if (!entry || entry.enabled === false || !entry.key.trim()) continue;
    const k = interpolateText(entry.key.trim(), context);
    const v = interpolateText(entry.value ?? '', context);
    pairs.push([k, v]);
  }
  return pairs;
}

function buildTokenRecordFromResponse(
  parsedBody: Record<string, unknown>,
  fallbackRefreshToken: string | undefined,
  fallbackScope: string | undefined,
  nowMs: number,
): OAuth2TokenRecord {
  const accessToken = String(parsedBody.access_token ?? '');
  const tokenType =
    typeof parsedBody.token_type === 'string' && parsedBody.token_type.trim()
      ? parsedBody.token_type.trim()
      : 'Bearer';
  const refreshToken =
    typeof parsedBody.refresh_token === 'string'
      ? parsedBody.refresh_token
      : fallbackRefreshToken;
  const scope =
    typeof parsedBody.scope === 'string' ? parsedBody.scope : fallbackScope;
  const idToken =
    typeof parsedBody.id_token === 'string' ? parsedBody.id_token : undefined;

  let expiresIn: number | undefined;
  if (typeof parsedBody.expires_in === 'number' && Number.isFinite(parsedBody.expires_in)) {
    expiresIn = parsedBody.expires_in;
  } else if (
    typeof parsedBody.expires_in === 'string' &&
    parsedBody.expires_in.trim() !== '' &&
    !Number.isNaN(Number(parsedBody.expires_in))
  ) {
    expiresIn = Number(parsedBody.expires_in);
  }

  const decodedJwt = decodeJwtToken(accessToken, nowMs);
  const acquiredAt = new Date(nowMs).toISOString();
  let expiresAt: string | undefined;
  if (expiresIn !== undefined) {
    expiresAt = new Date(nowMs + expiresIn * 1000).toISOString();
  } else if (decodedJwt.expiresAt) {
    expiresAt = decodedJwt.expiresAt;
  }

  return {
    accessToken,
    tokenType,
    ...(refreshToken ? { refreshToken } : {}),
    ...(scope ? { scope } : {}),
    ...(idToken ? { idToken } : {}),
    ...(expiresIn !== undefined ? { expiresIn } : {}),
    acquiredAt,
    ...(expiresAt ? { expiresAt } : {}),
    rawResponse: parsedBody,
    decodedJwt,
  };
}

function parseTokenEndpointPayload(rawBody: string): Record<string, unknown> {
  const trimmed = rawBody.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Some OAuth providers (e.g. GitHub) can return urlencoded responses if Accept is ignored
    const params = new URLSearchParams(trimmed);
    const out: Record<string, unknown> = {};
    params.forEach((v, k) => {
      out[k] = v;
    });
    if ('access_token' in out || 'error' in out) {
      return out;
    }
  }
  return { raw: rawBody };
}

/**
 * Executes an OAuth 2.0 token acquisition flow (`password`, `client_credentials`,
 * `authorization_code`, `authorization_code_pkce`, or `refresh_token`), caches the
 * resulting token in memory + `secretStore`, and decodes any JWT claims.
 */
export async function acquireOAuth2Token(
  request: OAuth2GetTokenRequest,
  deps: OAuth2EngineDeps = {},
): Promise<OAuth2TokenExchangeResult> {
  const startTime = Date.now();
  const nowMs = deps.now ? deps.now() : startTime;
  const context = request.interpolationContext ?? {};
  const { config } = request;

  const grantType = config.grantType;
  const accessTokenUrl = interpolateText(config.accessTokenUrl ?? '', context).trim();
  const clientId = interpolateText(config.clientId ?? '', context).trim();
  const clientSecret =
    config.clientSecret !== undefined
      ? interpolateText(config.clientSecret, context)
      : '';
  const scope =
    config.scope !== undefined ? interpolateText(config.scope, context).trim() : '';
  const clientAuthMethod = config.clientAuthMethod ?? 'basic_header';
  const extraPairs = interpolateExtraParams(config.extraParams, context);

  if (!accessTokenUrl) {
    return {
      ok: false,
      error: 'OAuth 2.0 accessTokenUrl is required',
    };
  }

  const formParams = new URLSearchParams();
  const requestHeaders: Record<string, string> = {};

  if (clientAuthMethod === 'basic_header') {
    if (clientId || clientSecret) {
      const encoded = Buffer.from(`${clientId}:${clientSecret}`, 'utf-8').toString('base64');
      requestHeaders.Authorization = `Basic ${encoded}`;
    }
  } else {
    if (clientId) formParams.set('client_id', clientId);
    if (clientSecret) formParams.set('client_secret', clientSecret);
  }

  let fallbackRefreshToken: string | undefined;

  try {
    if (grantType === 'password') {
      const username = interpolateText(config.username ?? '', context);
      const password = interpolateText(config.password ?? '', context);
      formParams.set('grant_type', 'password');
      formParams.set('username', username);
      formParams.set('password', password);
      if (clientAuthMethod === 'basic_header' && clientId && !clientSecret) {
        formParams.set('client_id', clientId);
      }
      if (scope) formParams.set('scope', scope);
    } else if (grantType === 'client_credentials') {
      formParams.set('grant_type', 'client_credentials');
      if (scope) formParams.set('scope', scope);
    } else if (grantType === 'refresh_token') {
      const existingCached = request.coordinate
        ? getCachedOAuth2Token(request.coordinate, deps)
        : null;
      const refreshTok =
        interpolateText(config.refreshToken ?? '', context).trim() ||
        existingCached?.refreshToken ||
        '';
      if (!refreshTok) {
        return {
          ok: false,
          error: 'OAuth 2.0 refresh_token is required for refresh_token grant',
        };
      }
      fallbackRefreshToken = refreshTok;
      formParams.set('grant_type', 'refresh_token');
      formParams.set('refresh_token', refreshTok);
      if (scope) formParams.set('scope', scope);
    } else if (
      grantType === 'authorization_code' ||
      grantType === 'authorization_code_pkce'
    ) {
      const authorizationUrl = interpolateText(
        config.authorizationUrl ?? '',
        context,
      ).trim();
      if (!authorizationUrl) {
        return {
          ok: false,
          error: 'OAuth 2.0 authorizationUrl is required for authorization_code grant',
        };
      }

      const configuredRedirectUri = config.redirectUri
        ? interpolateText(config.redirectUri, context).trim()
        : undefined;

      const usePkce =
        grantType === 'authorization_code_pkce' || Boolean(config.pkceCodeChallengeMethod);
      const pkce = usePkce
        ? generatePkcePair(config.pkceCodeChallengeMethod ?? 'S256')
        : undefined;
      const state = base64UrlEncode(crypto.randomBytes(16));

      const buildAuthorizeUrl = (effectiveRedirectUri: string): string => {
        const u = new URL(authorizationUrl);
        u.searchParams.set('response_type', 'code');
        if (clientId) u.searchParams.set('client_id', clientId);
        u.searchParams.set('redirect_uri', effectiveRedirectUri);
        if (scope) u.searchParams.set('scope', scope);
        u.searchParams.set('state', state);
        if (pkce) {
          u.searchParams.set('code_challenge', pkce.codeChallenge);
          u.searchParams.set('code_challenge_method', pkce.codeChallengeMethod);
        }
        for (const [k, v] of extraPairs) {
          u.searchParams.set(k, v);
        }
        return u.toString();
      };

      let code: string;
      let effectiveRedirectUri: string;

      if (deps.authorizeCodeProvider) {
        effectiveRedirectUri = configuredRedirectUri || 'http://127.0.0.1/oauth2/callback';
        const authUrl = buildAuthorizeUrl(effectiveRedirectUri);
        const cbResult = await deps.authorizeCodeProvider({
          authorizationUrl: authUrl,
          redirectUri: effectiveRedirectUri,
          state,
          codeVerifier: pkce?.codeVerifier,
          codeChallenge: pkce?.codeChallenge,
          codeChallengeMethod: pkce?.codeChallengeMethod,
        });
        code = cbResult.code;
      } else {
        const loopbackResult = await listenForOAuth2LoopbackCallback({
          redirectUri: configuredRedirectUri,
          expectedState: state,
          buildAuthorizeUrl,
          timeoutMs: request.timeoutMs ?? 60000,
          onListening: async (_redirectUri, fullAuthUrl) => {
            if (deps.openExternalUrl) {
              await deps.openExternalUrl(fullAuthUrl);
            }
          },
        });
        code = loopbackResult.code;
        effectiveRedirectUri = loopbackResult.actualRedirectUri;
      }

      formParams.set('grant_type', 'authorization_code');
      formParams.set('code', code);
      formParams.set('redirect_uri', effectiveRedirectUri);
      if (clientId && !formParams.has('client_id')) {
        formParams.set('client_id', clientId);
      }
      if (pkce) {
        formParams.set('code_verifier', pkce.codeVerifier);
      }
    }

    for (const [k, v] of extraPairs) {
      formParams.set(k, v);
    }

    const response = await postFormUrlEncoded({
      url: accessTokenUrl,
      formBody: formParams.toString(),
      headers: requestHeaders,
      verifySsl: request.verifySsl,
      timeoutMs: request.timeoutMs,
    });

    const durationMs = Math.max(0, Date.now() - startTime);
    const parsedBody = parseTokenEndpointPayload(response.body);

    const diagnostics = {
      requestUrl: accessTokenUrl,
      grantType,
      clientAuthMethod,
      statusCode: response.statusCode,
      responseBody: response.body,
      durationMs,
    };

    if (response.statusCode < 200 || response.statusCode >= 300 || !parsedBody.access_token) {
      const errCode =
        typeof parsedBody.error === 'string'
          ? parsedBody.error
          : `HTTP ${response.statusCode}`;
      const errDesc =
        typeof parsedBody.error_description === 'string'
          ? `: ${parsedBody.error_description}`
          : '';
      return {
        ok: false,
        status: response.statusCode,
        error: `OAuth 2.0 token exchange failed (${errCode}${errDesc})`,
        diagnostics,
      };
    }

    const tokenRecord = buildTokenRecordFromResponse(
      parsedBody,
      fallbackRefreshToken,
      scope || undefined,
      nowMs,
    );

    if (request.coordinate) {
      cacheOAuth2Token(request.coordinate, tokenRecord, deps);
    }

    return {
      ok: true,
      status: response.statusCode,
      token: tokenRecord,
      diagnostics,
    };
  } catch (err) {
    const durationMs = Math.max(0, Date.now() - startTime);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      diagnostics: {
        requestUrl: accessTokenUrl,
        grantType,
        clientAuthMethod,
        durationMs,
      },
    };
  }
}

/**
 * Refreshes an OAuth 2.0 token using the `refresh_token` grant type.
 */
export async function refreshOAuth2Token(
  request: OAuth2RefreshTokenRequest,
  deps: OAuth2EngineDeps = {},
): Promise<OAuth2TokenExchangeResult> {
  const existing = request.coordinate
    ? getCachedOAuth2Token(request.coordinate, deps)
    : null;
  const refreshTokenToUse =
    request.refreshToken || request.config.refreshToken || existing?.refreshToken;

  return acquireOAuth2Token(
    {
      config: {
        ...request.config,
        grantType: 'refresh_token',
        refreshToken: refreshTokenToUse,
      },
      coordinate: request.coordinate,
      interpolationContext: request.interpolationContext,
      verifySsl: request.verifySsl,
      timeoutMs: request.timeoutMs,
      forceRefresh: true,
    },
    deps,
  );
}

/**
 * Resolves the active OAuth 2.0 access token prior to executing an HTTP/GraphQL request:
 * - Returns the cached token if present and not expired (or if `autoRefresh` is disabled).
 * - When `autoRefresh: true`, refreshes an expired token (via `refresh_token` if available)
 *   or re-acquires a fresh token automatically.
 */
export async function resolveOAuth2AccessTokenForRequest(
  options: {
    config: OAuth2Config;
    coordinate?: OAuth2TokenCoordinate;
    interpolationContext?: VariableInterpolationContext;
    verifySsl?: boolean;
    timeoutMs?: number;
  },
  deps: OAuth2EngineDeps = {},
): Promise<string | undefined> {
  const nowMs = deps.now ? deps.now() : Date.now();
  const cached = options.coordinate
    ? getCachedOAuth2Token(options.coordinate, deps)
    : null;

  const autoRefresh = options.config.autoRefresh ?? false;

  if (cached && !isOAuth2TokenExpired(cached, TOKEN_EXPIRY_BUFFER_SECONDS, nowMs)) {
    return cached.accessToken;
  }

  if (!autoRefresh) {
    return cached?.accessToken;
  }

  // If cached token has a refresh token, attempt refresh first
  if (cached?.refreshToken || options.config.refreshToken) {
    const refreshed = await refreshOAuth2Token(
      {
        config: options.config,
        refreshToken: cached?.refreshToken ?? options.config.refreshToken,
        coordinate: options.coordinate,
        interpolationContext: options.interpolationContext,
        verifySsl: options.verifySsl,
        timeoutMs: options.timeoutMs,
      },
      deps,
    );
    if (refreshed.ok && refreshed.token?.accessToken) {
      return refreshed.token.accessToken;
    }
  }

  // Fall back to full token acquisition
  const acquired = await acquireOAuth2Token(
    {
      config: options.config,
      coordinate: options.coordinate,
      interpolationContext: options.interpolationContext,
      verifySsl: options.verifySsl,
      timeoutMs: options.timeoutMs,
    },
    deps,
  );

  if (acquired.ok && acquired.token?.accessToken) {
    return acquired.token.accessToken;
  }

  return cached?.accessToken;
}
