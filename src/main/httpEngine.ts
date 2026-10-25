import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import * as tls from 'tls';
import * as zlib from 'zlib';
import type {
  AuthConfig,
  FormDataEntry,
  KeyValueEntry,
  RequestBodyConfig,
} from '../shared/collectionSchema';
import { generateAwjcId } from '../shared/collectionSchema';
import { evaluateAssertions } from '../shared/assertions';
import { evaluateCaptures } from '../shared/captures';
import type {
  HttpResponseResult,
  HttpTimingBreakdown,
  ParsedSetCookie,
  PreparedHttpRequest,
  RedirectHop,
  TlsCertificateDetails,
} from '../shared/httpTypes';
import { interpolateText, type VariableInterpolationContext } from '../shared/interpolation';
import { buildResolvedRequestUrl } from '../shared/urlParams';
import {
  injectRequestAuth,
  parseDigestChallenge,
  resolveEffectiveAuth,
} from './authEngine';
import {
  resolveOAuth2AccessTokenForRequest,
  type OAuth2EngineDeps,
} from './oauth2Engine';

const activeRequestControllers = new Map<string, AbortController>();

export interface HttpEngineDeps {
  readFileBuffer?: (filePath: string) => Buffer;
  fileExists?: (filePath: string) => boolean;
  oauth2Deps?: OAuth2EngineDeps;
}

const DEFAULT_BODY_CONTENT_TYPES: Partial<Record<RequestBodyConfig['mode'], string>> = {
  json: 'application/json',
  yaml: 'application/x-yaml',
  xml: 'application/xml',
  html: 'text/html',
  text: 'text/plain',
  'form-urlencoded': 'application/x-www-form-urlencoded',
  binary: 'application/octet-stream',
};

/**
 * Cancels an in-flight HTTP request by its `requestId`.
 * Returns `true` if an active request was found and aborted.
 */
export function cancelHttpRequest(requestId: string): boolean {
  const controller = activeRequestControllers.get(requestId);
  if (!controller) return false;
  controller.abort();
  activeRequestControllers.delete(requestId);
  return true;
}

/**
 * Returns the number of currently active in-flight HTTP requests.
 */
export function getActiveHttpRequestCount(): number {
  return activeRequestControllers.size;
}

/**
 * Parses a single `Set-Cookie` header string into structured attributes.
 */
export function parseSetCookieHeader(rawCookie: string): ParsedSetCookie {
  const parts = rawCookie
    .split(';')
    .map(p => p.trim())
    .filter(Boolean);

  const first = parts[0] ?? '';
  const eqIdx = first.indexOf('=');
  const name = eqIdx === -1 ? first.trim() : first.slice(0, eqIdx).trim();
  const value = eqIdx === -1 ? '' : first.slice(eqIdx + 1).trim();

  const parsed: ParsedSetCookie = {
    name,
    value,
    httpOnly: false,
    secure: false,
    raw: rawCookie,
  };

  for (let i = 1; i < parts.length; i++) {
    const attr = parts[i];
    const attrEq = attr.indexOf('=');
    const attrKey = (attrEq === -1 ? attr : attr.slice(0, attrEq)).trim().toLowerCase();
    const attrVal = attrEq === -1 ? '' : attr.slice(attrEq + 1).trim();

    if (attrKey === 'domain') {
      parsed.domain = attrVal;
    } else if (attrKey === 'path') {
      parsed.path = attrVal;
    } else if (attrKey === 'expires') {
      parsed.expires = attrVal;
    } else if (attrKey === 'max-age') {
      const n = Number.parseInt(attrVal, 10);
      if (!Number.isNaN(n)) parsed.maxAge = n;
    } else if (attrKey === 'httponly') {
      parsed.httpOnly = true;
    } else if (attrKey === 'secure') {
      parsed.secure = true;
    } else if (attrKey === 'samesite') {
      parsed.sameSite = attrVal;
    }
  }

  return parsed;
}

/**
 * Parses all `Set-Cookie` headers from an HTTP response.
 */
export function parseSetCookieHeaders(
  setCookieHeader: string | string[] | undefined,
): ParsedSetCookie[] {
  if (!setCookieHeader) return [];
  const list = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return list.filter(Boolean).map(parseSetCookieHeader);
}

function hasHeaderCaseInsensitive(headers: Record<string, string>, key: string): boolean {
  const lower = key.toLowerCase();
  return Object.keys(headers).some(k => k.toLowerCase() === lower);
}

function getHeaderCaseInsensitive(
  headers: Record<string, string>,
  key: string,
): string | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

function guessMimeTypeFromFilename(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.yaml':
    case '.yml':
      return 'application/x-yaml';
    case '.xml':
      return 'application/xml';
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.csv':
      return 'text/csv';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

export function buildMultipartFormDataBuffer(
  entries: FormDataEntry[],
  context: VariableInterpolationContext,
  deps: HttpEngineDeps,
  customBoundary?: string,
): { buffer: Buffer; contentType: string; boundary: string } {
  const boundary = customBoundary ?? `----AwapiLassoBoundary${Date.now().toString(36)}`;
  const chunks: Buffer[] = [];
  const readFile = deps.readFileBuffer ?? ((p: string) => fs.readFileSync(p));

  for (const entry of entries) {
    if (!entry || entry.enabled === false || !entry.key.trim()) continue;
    const fieldName = interpolateText(entry.key.trim(), context).replace(/"/g, '\\"');

    if (entry.type === 'file') {
      const resolvedPath = interpolateText(entry.filePath ?? '', context).trim();
      if (!resolvedPath) continue;
      const fileBuf = readFile(resolvedPath);
      const fileName = path.basename(resolvedPath).replace(/"/g, '\\"');
      const mimeType =
        entry.contentType?.trim() || guessMimeTypeFromFilename(resolvedPath);

      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n` +
            `Content-Type: ${mimeType}\r\n\r\n`,
          'utf-8',
        ),
      );
      chunks.push(fileBuf);
      chunks.push(Buffer.from('\r\n', 'utf-8'));
    } else {
      const textVal = interpolateText(entry.value ?? '', context);
      const mimeHeader = entry.contentType?.trim()
        ? `\r\nContent-Type: ${entry.contentType.trim()}`
        : '';
      chunks.push(
        Buffer.from(
          `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="${fieldName}"${mimeHeader}\r\n\r\n` +
            `${textVal}\r\n`,
          'utf-8',
        ),
      );
    }
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf-8'));
  return {
    buffer: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
    boundary,
  };
}

export function prepareRequestBodyPayload(
  request: PreparedHttpRequest,
  headers: Record<string, string>,
  context: VariableInterpolationContext,
  deps: HttpEngineDeps,
): { bodyBuffer?: Buffer; headers: Record<string, string>; urlOverride?: string } {
  const nextHeaders = { ...headers };
  const methodUpper = (request.method || 'GET').toUpperCase();

  // GraphQL request protocol handling
  if (request.protocol === 'graphql' && request.graphql) {
    const query = interpolateText(request.graphql.query ?? '', context);
    const operationName = request.graphql.operationName
      ? interpolateText(request.graphql.operationName, context).trim()
      : undefined;
    let variablesObj: unknown = undefined;
    if (request.graphql.variables && request.graphql.variables.trim()) {
      const interpolatedVars = interpolateText(request.graphql.variables, context);
      try {
        variablesObj = JSON.parse(interpolatedVars);
      } catch {
        variablesObj = interpolatedVars;
      }
    }

    if (methodUpper === 'GET') {
      return { headers: nextHeaders };
    }

    const gqlPayload: Record<string, unknown> = { query };
    if (variablesObj !== undefined) gqlPayload.variables = variablesObj;
    if (operationName) gqlPayload.operationName = operationName;

    const jsonBuf = Buffer.from(JSON.stringify(gqlPayload), 'utf-8');
    if (!hasHeaderCaseInsensitive(nextHeaders, 'Content-Type')) {
      nextHeaders['Content-Type'] = 'application/json';
    }
    return { bodyBuffer: jsonBuf, headers: nextHeaders };
  }

  const body = request.body;
  if (!body || body.mode === 'none') {
    return { headers: nextHeaders };
  }

  switch (body.mode) {
    case 'json':
    case 'yaml':
    case 'xml':
    case 'html':
    case 'text': {
      const textContent = interpolateText(body.content ?? '', context);
      const buf = Buffer.from(textContent, 'utf-8');
      if (!hasHeaderCaseInsensitive(nextHeaders, 'Content-Type')) {
        nextHeaders['Content-Type'] =
          body.contentType?.trim() ||
          DEFAULT_BODY_CONTENT_TYPES[body.mode] ||
          'text/plain';
      }
      return { bodyBuffer: buf, headers: nextHeaders };
    }

    case 'form-urlencoded': {
      const params = new URLSearchParams();
      if (Array.isArray(body.urlEncoded) && body.urlEncoded.length > 0) {
        for (const entry of body.urlEncoded) {
          if (!entry || entry.enabled === false || !entry.key.trim()) continue;
          const k = interpolateText(entry.key.trim(), context);
          const v = interpolateText(entry.value ?? '', context);
          params.append(k, v);
        }
      } else if (body.content) {
        const rawInterpolated = interpolateText(body.content, context);
        const parsed = new URLSearchParams(rawInterpolated);
        parsed.forEach((v, k) => params.append(k, v));
      }
      const buf = Buffer.from(params.toString(), 'utf-8');
      if (!hasHeaderCaseInsensitive(nextHeaders, 'Content-Type')) {
        nextHeaders['Content-Type'] =
          body.contentType?.trim() || 'application/x-www-form-urlencoded';
      }
      return { bodyBuffer: buf, headers: nextHeaders };
    }

    case 'multipart-form': {
      const built = buildMultipartFormDataBuffer(
        body.formData ?? [],
        context,
        deps,
      );
      if (!hasHeaderCaseInsensitive(nextHeaders, 'Content-Type')) {
        nextHeaders['Content-Type'] = built.contentType;
      }
      return { bodyBuffer: built.buffer, headers: nextHeaders };
    }

    case 'binary': {
      const filePath = interpolateText(body.binaryFilePath ?? '', context).trim();
      if (!filePath) {
        return { headers: nextHeaders };
      }
      const readFile = deps.readFileBuffer ?? ((p: string) => fs.readFileSync(p));
      const buf = readFile(filePath);
      if (!hasHeaderCaseInsensitive(nextHeaders, 'Content-Type')) {
        nextHeaders['Content-Type'] =
          body.contentType?.trim() || guessMimeTypeFromFilename(filePath);
      }
      return { bodyBuffer: buf, headers: nextHeaders };
    }
  }
}

function mergeRequestHeaders(
  inheritedHeaders: KeyValueEntry[] | undefined,
  requestHeaders: KeyValueEntry[] | undefined,
  context: VariableInterpolationContext,
): Record<string, string> {
  const byLowerKey = new Map<string, { key: string; value: string }>();

  const applyList = (list: KeyValueEntry[] | undefined) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!entry || entry.enabled === false || !entry.key.trim()) continue;
      const resolvedKey = interpolateText(entry.key.trim(), context);
      const resolvedVal = interpolateText(entry.value ?? '', context);
      byLowerKey.set(resolvedKey.toLowerCase(), {
        key: resolvedKey,
        value: resolvedVal,
      });
    }
  };

  applyList(inheritedHeaders);
  applyList(requestHeaders);

  const out: Record<string, string> = {};
  for (const { key, value } of byLowerKey.values()) {
    out[key] = value;
  }
  return out;
}

function formatDistinguishedName(dn: tls.Certificate | undefined): string {
  if (!dn || typeof dn !== 'object') return '';
  const parts: string[] = [];
  if (dn.CN) parts.push(`CN=${Array.isArray(dn.CN) ? dn.CN.join(',') : dn.CN}`);
  if (dn.O) parts.push(`O=${Array.isArray(dn.O) ? dn.O.join(',') : dn.O}`);
  if (dn.C) parts.push(`C=${Array.isArray(dn.C) ? dn.C.join(',') : dn.C}`);
  if (parts.length > 0) return parts.join(', ');
  return Object.entries(dn)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
    .join(', ');
}

function extractTlsDetails(socket: unknown): TlsCertificateDetails | null {
  if (!socket || typeof socket !== 'object') return null;
  const tlsSocket = socket as tls.TLSSocket;
  if (!tlsSocket.encrypted || typeof tlsSocket.getPeerCertificate !== 'function') {
    return null;
  }

  try {
    const cert = tlsSocket.getPeerCertificate(false);
    const protocol =
      typeof tlsSocket.getProtocol === 'function' ? tlsSocket.getProtocol() ?? '' : '';
    const cipherObj =
      typeof tlsSocket.getCipher === 'function' ? tlsSocket.getCipher() : undefined;
    const cipher = cipherObj?.name
      ? `${cipherObj.name}${cipherObj.version ? ` (${cipherObj.version})` : ''}`
      : '';

    if (!cert || Object.keys(cert).length === 0) {
      if (!protocol && !cipher) return null;
      return {
        subject: '',
        issuer: '',
        validFrom: '',
        validTo: '',
        protocol,
        cipher,
      };
    }

    return {
      subject: formatDistinguishedName(cert.subject),
      issuer: formatDistinguishedName(cert.issuer),
      validFrom: cert.valid_from ?? '',
      validTo: cert.valid_to ?? '',
      protocol,
      cipher,
      fingerprint256: cert.fingerprint256,
    };
  } catch {
    return null;
  }
}

function decompressResponseBuffer(buffer: Buffer, contentEncoding: string | undefined): Buffer {
  if (!contentEncoding || buffer.byteLength === 0) return buffer;
  const enc = contentEncoding.trim().toLowerCase();
  try {
    if (enc === 'gzip' || enc === 'x-gzip') {
      return zlib.gunzipSync(buffer);
    }
    if (enc === 'deflate') {
      return zlib.inflateSync(buffer);
    }
    if (enc === 'br') {
      return zlib.brotliDecompressSync(buffer);
    }
  } catch {
    // Return raw buffer if decompression fails
  }
  return buffer;
}

function isBinaryContentTypeOrPayload(contentType: string, buffer: Buffer): boolean {
  const lower = contentType.toLowerCase();
  if (
    lower.includes('application/json') ||
    lower.includes('text/') ||
    lower.includes('application/xml') ||
    lower.includes('application/javascript') ||
    lower.includes('application/x-yaml') ||
    lower.includes('application/yaml') ||
    lower.includes('image/svg+xml') ||
    lower.includes('+json') ||
    lower.includes('+xml')
  ) {
    return false;
  }
  if (
    lower.startsWith('image/') ||
    lower.startsWith('audio/') ||
    lower.startsWith('video/') ||
    lower.includes('application/pdf') ||
    lower.includes('application/octet-stream') ||
    lower.includes('application/zip')
  ) {
    return true;
  }
  // Check first 512 bytes for null bytes
  const sampleLen = Math.min(buffer.byteLength, 512);
  for (let i = 0; i < sampleLen; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

interface SingleHopResult {
  status: number;
  statusText: string;
  httpVersion: string;
  remoteAddress?: string;
  headers: Record<string, string>;
  rawHeaders: Array<{ key: string; value: string }>;
  cookies: ParsedSetCookie[];
  rawBuffer: Buffer;
  timings: HttpTimingBreakdown;
  tls: TlsCertificateDetails | null;
}

function executeSingleHttpHop(options: {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyBuffer?: Buffer;
  verifySsl: boolean;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<SingleHopResult> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(options.url);
    } catch {
      reject(new Error(`Invalid URL: "${options.url}"`));
      return;
    }

    if (options.signal.aborted) {
      const abortErr = new Error('Request cancelled');
      abortErr.name = 'AbortError';
      reject(abortErr);
      return;
    }

    const isHttps = parsedUrl.protocol === 'https:';
    const startMs = performance.now();
    let dnsEndMs: number | undefined;
    let tcpEndMs: number | undefined;
    let tlsEndMs: number | undefined;
    let ttfbEndMs: number | undefined;

    const reqHeaders: Record<string, string> = { ...options.headers };
    if (
      options.bodyBuffer &&
      options.bodyBuffer.byteLength > 0 &&
      !hasHeaderCaseInsensitive(reqHeaders, 'Content-Length')
    ) {
      reqHeaders['Content-Length'] = String(options.bodyBuffer.byteLength);
    }

    const reqOptions: https.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
      method: options.method.toUpperCase(),
      headers: reqHeaders,
      ...(isHttps ? { rejectUnauthorized: options.verifySsl } : {}),
    };

    const transport = isHttps ? https : http;
    let timedOut = false;

    let activeSocket: import('net').Socket | null = null;
    const onLookup = () => {
      dnsEndMs = performance.now();
    };
    const onConnect = () => {
      tcpEndMs = performance.now();
    };
    const onSecureConnect = () => {
      tlsEndMs = performance.now();
    };

    const onAbort = () => {
      const abortErr = new Error('Request cancelled');
      abortErr.name = 'AbortError';
      req.destroy(abortErr);
    };
    options.signal.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      options.signal.removeEventListener('abort', onAbort);
      if (activeSocket) {
        activeSocket.removeListener('lookup', onLookup);
        activeSocket.removeListener('connect', onConnect);
        activeSocket.removeListener('secureConnect', onSecureConnect);
      }
    };

    const req = transport.request(reqOptions, res => {
      ttfbEndMs = performance.now();
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(Buffer.from(chunk));
      });

      res.on('end', () => {
        cleanup();
        const endMs = performance.now();
        const rawBuffer = Buffer.concat(chunks);

        const dnsMs = dnsEndMs !== undefined ? Math.max(0, dnsEndMs - startMs) : 0;
        const tcpBase = dnsEndMs ?? startMs;
        const tcpMs = tcpEndMs !== undefined ? Math.max(0, tcpEndMs - tcpBase) : 0;
        const tlsBase = tcpEndMs ?? dnsEndMs ?? startMs;
        const tlsMs =
          isHttps && tlsEndMs !== undefined ? Math.max(0, tlsEndMs - tlsBase) : 0;
        const ttfbBase = (isHttps ? tlsEndMs : tcpEndMs) ?? dnsEndMs ?? startMs;
        const ttfbMs =
          ttfbEndMs !== undefined ? Math.max(0, ttfbEndMs - ttfbBase) : 0;
        const downloadMs =
          ttfbEndMs !== undefined ? Math.max(0, endMs - ttfbEndMs) : 0;
        const totalMs = Math.max(0, endMs - startMs);

        const headersRecord: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v === undefined) continue;
          headersRecord[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }

        const rawHeadersList: Array<{ key: string; value: string }> = [];
        for (let i = 0; i < res.rawHeaders.length; i += 2) {
          rawHeadersList.push({
            key: res.rawHeaders[i] ?? '',
            value: res.rawHeaders[i + 1] ?? '',
          });
        }

        const cookies = parseSetCookieHeaders(res.headers['set-cookie']);
        const tlsDetails = extractTlsDetails(res.socket);

        resolve({
          status: res.statusCode ?? 0,
          statusText: res.statusMessage || http.STATUS_CODES[res.statusCode ?? 0] || '',
          httpVersion: res.httpVersion || '1.1',
          remoteAddress: res.socket?.remoteAddress,
          headers: headersRecord,
          rawHeaders: rawHeadersList,
          cookies,
          rawBuffer,
          timings: {
            dnsMs: Number(dnsMs.toFixed(2)),
            tcpMs: Number(tcpMs.toFixed(2)),
            tlsMs: Number(tlsMs.toFixed(2)),
            ttfbMs: Number(ttfbMs.toFixed(2)),
            downloadMs: Number(downloadMs.toFixed(2)),
            totalMs: Number(totalMs.toFixed(2)),
          },
          tls: tlsDetails,
        });
      });

      res.on('error', err => {
        cleanup();
        reject(err);
      });
    });

    req.on('socket', socket => {
      activeSocket = socket;
      socket.once('lookup', onLookup);
      socket.once('connect', onConnect);
      socket.once('secureConnect', onSecureConnect);
    });

    req.setTimeout(options.timeoutMs, () => {
      timedOut = true;
      const timeoutErr = new Error(`Request timed out after ${options.timeoutMs}ms`);
      timeoutErr.name = 'TimeoutError';
      req.destroy(timeoutErr);
    });

    req.on('error', err => {
      cleanup();
      if (timedOut) {
        err.name = 'TimeoutError';
      }
      reject(err);
    });

    if (
      options.bodyBuffer &&
      options.bodyBuffer.byteLength > 0 &&
      options.method.toUpperCase() !== 'HEAD'
    ) {
      req.write(options.bodyBuffer);
    }
    req.end();
  });
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

/**
 * Executes an HTTP, REST, or GraphQL request natively in Node.js with zero CORS restrictions,
 * full phase timing breakdown, cookie parsing, TLS inspection, redirect following,
 * hierarchical auth injection (including Digest challenge-response and OAuth 2.0 auto-refresh),
 * and declarative post-response captures & assertions.
 */
export async function executeHttpRequest(
  request: PreparedHttpRequest,
  deps: HttpEngineDeps = {},
): Promise<HttpResponseResult> {
  const requestId = request.requestId || generateAwjcId('reqrun');
  const abortController = new AbortController();
  activeRequestControllers.set(requestId, abortController);

  const overallStartMs = performance.now();
  const context = request.interpolationContext ?? {};
  const timeoutMs = request.timeoutMs ?? 30000;
  const followRedirects = request.followRedirects ?? true;
  const maxRedirects = request.maxRedirects ?? 10;
  const verifySsl = request.verifySsl ?? true;

  try {
    // 1. Resolve URL (with path params, query params, and {{variables}})
    let extraGraphqlGetParams = request.queryParams ? [...request.queryParams] : undefined;
    if (
      request.protocol === 'graphql' &&
      request.graphql &&
      (request.method || 'GET').toUpperCase() === 'GET'
    ) {
      extraGraphqlGetParams = [...(extraGraphqlGetParams ?? [])];
      extraGraphqlGetParams.push({
        key: 'query',
        value: request.graphql.query,
        enabled: true,
      });
      if (request.graphql.variables?.trim()) {
        extraGraphqlGetParams.push({
          key: 'variables',
          value: request.graphql.variables.trim(),
          enabled: true,
        });
      }
      if (request.graphql.operationName?.trim()) {
        extraGraphqlGetParams.push({
          key: 'operationName',
          value: request.graphql.operationName.trim(),
          enabled: true,
        });
      }
    }

    const initialResolvedUrl = buildResolvedRequestUrl({
      rawUrl: request.url,
      queryParams: extraGraphqlGetParams,
      pathParams: request.pathParams,
      context,
    });

    // 2. Merge inherited + request headers
    const mergedHeaders = mergeRequestHeaders(
      request.inheritedHeaders,
      request.headers,
      context,
    );

    // 3. Prepare request body payload & default Content-Type header
    const preparedBody = prepareRequestBodyPayload(
      request,
      mergedHeaders,
      context,
      deps,
    );

    // 4. Resolve effective authentication
    const resolvedAuth = resolveEffectiveAuth({
      requestAuth: request.auth,
      requestOwnerId: request.authOwnerId,
      ancestorAuthChain: request.ancestorAuthChain,
      collectionDefaultAuth: request.collectionDefaultAuth,
      collectionId: request.collectionId,
      authProfiles: request.authProfiles,
    });
    const effectiveAuth: AuthConfig = resolvedAuth.config;

    // 5. If effective auth is OAuth 2.0, resolve cached or auto-refreshed access token
    let oauth2AccessToken: string | undefined;
    if (effectiveAuth.type === 'oauth2' && effectiveAuth.oauth2) {
      const coordinate =
        request.collectionId && (resolvedAuth.sourceOwnerId || request.authOwnerId)
          ? {
              collectionId: request.collectionId,
              environmentId: request.environmentId || 'default',
              profileOrRequestId:
                resolvedAuth.sourceOwnerId || request.authOwnerId || 'default',
            }
          : undefined;
      oauth2AccessToken = await resolveOAuth2AccessTokenForRequest(
        {
          config: effectiveAuth.oauth2,
          coordinate,
          interpolationContext: context,
          verifySsl,
          timeoutMs,
        },
        deps.oauth2Deps,
      );
    }

    // 6. Inject auth into URL and headers
    let currentMethod = (request.method || 'GET').toUpperCase();
    let currentBodyBuffer = preparedBody.bodyBuffer;
    const authInjected = injectRequestAuth({
      auth: effectiveAuth,
      method: currentMethod,
      url: initialResolvedUrl,
      headers: preparedBody.headers,
      body: currentBodyBuffer,
      context,
      oauth2AccessToken,
    });

    let currentUrl = authInjected.url;
    let currentHeaders = authInjected.headers;
    const redirects: RedirectHop[] = [];
    let digestRetried = false;
    let lastHop: SingleHopResult | null = null;

    while (true) {
      const hopResult = await executeSingleHttpHop({
        method: currentMethod,
        url: currentUrl,
        headers: currentHeaders,
        bodyBuffer: currentBodyBuffer,
        verifySsl,
        timeoutMs,
        signal: abortController.signal,
      });
      lastHop = hopResult;

      // Handle Digest 401 challenge-response automatically once
      if (
        hopResult.status === 401 &&
        effectiveAuth.type === 'digest' &&
        effectiveAuth.digest &&
        !digestRetried
      ) {
        const wwwAuth = getHeaderCaseInsensitive(
          hopResult.headers,
          'www-authenticate',
        );
        const challenge = wwwAuth ? parseDigestChallenge(wwwAuth) : null;
        if (challenge) {
          digestRetried = true;
          const retryAuth = injectRequestAuth({
            auth: effectiveAuth,
            method: currentMethod,
            url: currentUrl,
            headers: preparedBody.headers,
            body: currentBodyBuffer,
            context,
            digestChallenge: challenge,
          });
          currentHeaders = retryAuth.headers;
          continue;
        }
      }

      // Handle 3xx redirects when followRedirects is enabled
      if (
        followRedirects &&
        isRedirectStatus(hopResult.status) &&
        redirects.length < maxRedirects
      ) {
        const locationHeader = getHeaderCaseInsensitive(hopResult.headers, 'location');
        if (locationHeader) {
          const nextUrl = new URL(locationHeader, currentUrl).toString();
          redirects.push({
            fromUrl: currentUrl,
            toUrl: nextUrl,
            statusCode: hopResult.status,
            method: currentMethod,
            durationMs: hopResult.timings.totalMs,
          });

          if (
            hopResult.status === 303 ||
            ((hopResult.status === 301 || hopResult.status === 302) &&
              currentMethod === 'POST')
          ) {
            currentMethod = 'GET';
            currentBodyBuffer = undefined;
            const nextHeaders: Record<string, string> = {};
            for (const [k, v] of Object.entries(currentHeaders)) {
              const lower = k.toLowerCase();
              if (lower !== 'content-length' && lower !== 'content-type') {
                nextHeaders[k] = v;
              }
            }
            currentHeaders = nextHeaders;
          }

          currentUrl = nextUrl;
          continue;
        }
      }

      break;
    }

    const finalHop = lastHop!;
    const contentEncoding = getHeaderCaseInsensitive(
      finalHop.headers,
      'content-encoding',
    );
    const uncompressedBuffer = decompressResponseBuffer(
      finalHop.rawBuffer,
      contentEncoding,
    );
    const contentType =
      getHeaderCaseInsensitive(finalHop.headers, 'content-type') ?? '';
    const isBinary = isBinaryContentTypeOrPayload(contentType, uncompressedBuffer);
    const bodyString = isBinary
      ? ''
      : uncompressedBuffer.toString('utf-8');
    const bodyBase64 = isBinary
      ? uncompressedBuffer.toString('base64')
      : undefined;

    const totalElapsedMs = Number(
      Math.max(finalHop.timings.totalMs, performance.now() - overallStartMs).toFixed(2),
    );
    const timings: HttpTimingBreakdown = {
      ...finalHop.timings,
      totalMs: totalElapsedMs,
    };

    const baseResponse = {
      status: finalHop.status,
      headers: finalHop.headers,
      cookies: finalHop.cookies,
      body: bodyString,
      timings,
    };

    const captures = evaluateCaptures(request.captures, baseResponse);
    const assertions = evaluateAssertions(request.assertions, baseResponse);

    return {
      requestId,
      ok: true,
      finalUrl: currentUrl,
      method: currentMethod,
      status: finalHop.status,
      statusText: finalHop.statusText,
      httpVersion: finalHop.httpVersion,
      remoteAddress: finalHop.remoteAddress,
      headers: finalHop.headers,
      rawHeaders: finalHop.rawHeaders,
      cookies: finalHop.cookies,
      body: bodyString,
      ...(bodyBase64 !== undefined ? { bodyBase64 } : {}),
      isBinary,
      contentType,
      sizeBytes: uncompressedBuffer.byteLength,
      transferSizeBytes: finalHop.rawBuffer.byteLength,
      timings,
      tls: finalHop.tls,
      redirects,
      captures,
      assertions,
      sentHeaders: currentHeaders,
    };
  } catch (err) {
    const isCancelled =
      abortController.signal.aborted ||
      (err instanceof Error && err.name === 'AbortError');
    const isTimedOut = err instanceof Error && err.name === 'TimeoutError';
    const elapsedMs = Number(Math.max(0, performance.now() - overallStartMs).toFixed(2));

    return {
      requestId,
      ok: false,
      cancelled: isCancelled,
      timedOut: isTimedOut,
      error: err instanceof Error ? err.message : String(err),
      finalUrl: request.url,
      method: (request.method || 'GET').toUpperCase(),
      status: 0,
      statusText: isCancelled ? 'Cancelled' : isTimedOut ? 'Timed Out' : 'Network Error',
      httpVersion: '',
      headers: {},
      rawHeaders: [],
      cookies: [],
      body: '',
      isBinary: false,
      contentType: '',
      sizeBytes: 0,
      transferSizeBytes: 0,
      timings: {
        dnsMs: 0,
        tcpMs: 0,
        tlsMs: 0,
        ttfbMs: 0,
        downloadMs: 0,
        totalMs: elapsedMs,
      },
      tls: null,
      redirects: [],
      captures: [],
      assertions: [],
      sentHeaders: {},
    };
  } finally {
    activeRequestControllers.delete(requestId);
  }
}
