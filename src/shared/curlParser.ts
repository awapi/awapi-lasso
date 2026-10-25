import {
  createDefaultHttpRequest,
  type AuthConfig,
  type FormDataEntry,
  type HttpMethod,
  type KeyValueEntry,
  type PathParamEntry,
  type QueryParamEntry,
  type RequestBodyConfig,
  type RequestItem,
} from './collectionSchema';
import {
  syncPathParamsFromUrl,
  syncQueryParamsFromUrl,
  syncUrlFromQueryParams,
} from './urlParams';

export interface ParsedCurlCommand {
  method: HttpMethod;
  url: string;
  queryParams: QueryParamEntry[];
  pathParams: PathParamEntry[];
  headers: KeyValueEntry[];
  auth: AuthConfig;
  body: RequestBodyConfig;
  compressed?: boolean;
  insecure?: boolean;
  followRedirects?: boolean;
}

/**
 * Checks whether a raw string (such as pasted clipboard text) is a `curl` command.
 */
export function isCurlCommand(input: string): boolean {
  if (!input || typeof input !== 'string') return false;
  const trimmed = input.trim();
  return /^curl(?:\.exe)?(?:\s|\\|\^|`|$)/i.test(trimmed);
}

/**
 * Normalizes multi-line continuations (`\` on bash/zsh, `^` on Windows cmd, `` ` `` on PowerShell)
 * outside of quoted strings into single spaces.
 */
function normalizeContinuations(input: string): string {
  let result = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result += ch;
      i++;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      result += ch;
      i++;
      continue;
    }

    if (!inSingle) {
      // Handle backslash, caret, or backtick followed by optional horizontal whitespace and newline
      if (ch === '\\' || (!inDouble && (ch === '^' || ch === '`'))) {
        const rest = input.slice(i + 1);
        const match = rest.match(/^[ \t]*\r?\n[ \t]*/);
        if (match) {
          result += ' ';
          i += 1 + match[0].length;
          continue;
        }
      }
    }

    if (ch === '\\' && inDouble && i + 1 < input.length) {
      result += ch + input[i + 1];
      i += 2;
      continue;
    }

    result += ch;
    i++;
  }

  return result;
}

/**
 * Tokenizes a shell command string into arguments, respecting single quotes,
 * double quotes, ANSI-C `$'...'` strings, and backslash escapes.
 */
export function tokenizeCurlArgs(input: string): string[] {
  const normalized = normalizeContinuations(input.trim());
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let i = 0;

  while (i < normalized.length) {
    const ch = normalized[i];

    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = '';
        inToken = false;
      }
      i++;
      continue;
    }

    inToken = true;

    // ANSI-C quoting: $'...'
    if (ch === '$' && normalized[i + 1] === "'") {
      i += 2;
      while (i < normalized.length && normalized[i] !== "'") {
        if (normalized[i] === '\\' && i + 1 < normalized.length) {
          const next = normalized[i + 1];
          if (next === 'n') current += '\n';
          else if (next === 'r') current += '\r';
          else if (next === 't') current += '\t';
          else if (next === "'" || next === '\\' || next === '"') current += next;
          else current += next;
          i += 2;
        } else {
          current += normalized[i];
          i++;
        }
      }
      if (normalized[i] === "'") i++;
      continue;
    }

    // Single-quoted string
    if (ch === "'") {
      i++;
      while (i < normalized.length && normalized[i] !== "'") {
        current += normalized[i];
        i++;
      }
      if (normalized[i] === "'") i++;
      continue;
    }

    // Double-quoted string
    if (ch === '"') {
      i++;
      while (i < normalized.length && normalized[i] !== '"') {
        if (normalized[i] === '\\' && i + 1 < normalized.length) {
          const next = normalized[i + 1];
          if (next === '"' || next === '\\' || next === '$' || next === '`') {
            current += next;
          } else if (next === 'n') {
            current += '\n';
          } else if (next === 'r') {
            current += '\r';
          } else if (next === 't') {
            current += '\t';
          } else {
            current += '\\' + next;
          }
          i += 2;
        } else {
          current += normalized[i];
          i++;
        }
      }
      if (normalized[i] === '"') i++;
      continue;
    }

    // Unquoted backslash escape
    if (ch === '\\' && i + 1 < normalized.length) {
      current += normalized[i + 1];
      i += 2;
      continue;
    }

    current += ch;
    i++;
  }

  if (inToken) {
    tokens.push(current);
  }

  return tokens;
}

function parseUrlEncodedPair(raw: string): KeyValueEntry {
  const eqIdx = raw.indexOf('=');
  if (eqIdx === -1) {
    return { key: safeDecode(raw), value: '', enabled: true };
  }
  const rawKey = raw.slice(0, eqIdx);
  const rawVal = raw.slice(eqIdx + 1);
  return {
    key: safeDecode(rawKey),
    value: safeDecode(rawVal),
    enabled: true,
  };
}

function parseUrlEncodedString(raw: string): KeyValueEntry[] {
  return raw
    .split('&')
    .filter(part => part.length > 0)
    .map(parseUrlEncodedPair);
}

function safeDecode(val: string): string {
  try {
    return decodeURIComponent(val.replace(/\+/g, '%20'));
  } catch {
    return val;
  }
}

function parseMultipartField(raw: string, isLiteralString = false): FormDataEntry {
  const eqIdx = raw.indexOf('=');
  if (eqIdx === -1) {
    return {
      key: raw.trim(),
      type: 'text',
      value: '',
      enabled: true,
    };
  }

  const key = raw.slice(0, eqIdx).trim();
  let rest = raw.slice(eqIdx + 1);
  let contentType: string | undefined;

  // Extract optional `;type=mime/type` suffix
  const typeMatch = rest.match(/;type=([^;]+)$/i);
  if (typeMatch) {
    contentType = typeMatch[1].trim();
    rest = rest.slice(0, typeMatch.index);
  }

  if (!isLiteralString && rest.startsWith('@')) {
    const filePath = rest.slice(1).trim();
    return {
      key,
      type: 'file',
      filePath,
      ...(contentType ? { contentType } : {}),
      enabled: true,
    };
  }

  return {
    key,
    type: 'text',
    value: rest,
    ...(contentType ? { contentType } : {}),
    enabled: true,
  };
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  if (
    !(trimmed.startsWith('{') && trimmed.endsWith('}')) &&
    !(trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeUrlCandidate(token: string): boolean {
  return (
    /^https?:\/\//i.test(token) ||
    /^\{\{[^{}]+\}\}/.test(token) ||
    /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?(?:\/|$)/i.test(token) ||
    /^[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}(?::\d+)?(?:\/|$)/.test(token)
  );
}

/**
 * Parses a `curl` command into structured HTTP request components.
 * Throws an error if the input is not a valid `curl` command or contains no URL.
 */
export function parseCurlCommand(command: string): ParsedCurlCommand {
  if (!isCurlCommand(command)) {
    throw new Error('Input is not a valid curl command');
  }

  const tokens = tokenizeCurlArgs(command);
  if (tokens.length === 0) {
    throw new Error('Empty curl command');
  }

  // Drop leading `curl` / `curl.exe`
  let idx = /^curl(?:\.exe)?$/i.test(tokens[0]) ? 1 : 0;

  let explicitMethod: string | undefined;
  let forceGet = false;
  let forceHead = false;
  let rawUrl = '';
  const headers: KeyValueEntry[] = [];
  let auth: AuthConfig = { type: 'inherit' };
  const rawDataParts: string[] = [];
  const urlEncodedEntries: KeyValueEntry[] = [];
  const formEntries: FormDataEntry[] = [];
  let hasUrlEncodeFlag = false;
  let compressed = false;
  let insecure = false;
  let followRedirects = false;

  const consumeValue = (): string => {
    idx++;
    return idx < tokens.length ? tokens[idx] : '';
  };

  while (idx < tokens.length) {
    const token = tokens[idx];

    if (token === '-X' || token === '--request') {
      explicitMethod = consumeValue().toUpperCase();
    } else if (token.startsWith('--request=')) {
      explicitMethod = token.slice('--request='.length).toUpperCase();
    } else if (/^-X[A-Z]+$/i.test(token)) {
      explicitMethod = token.slice(2).toUpperCase();
    } else if (token === '--url') {
      rawUrl = consumeValue();
    } else if (token.startsWith('--url=')) {
      rawUrl = token.slice('--url='.length);
    } else if (token === '-H' || token === '--header') {
      const rawHeader = consumeValue();
      const colonIdx = rawHeader.indexOf(':');
      if (colonIdx !== -1) {
        const key = rawHeader.slice(0, colonIdx).trim();
        const value = rawHeader.slice(colonIdx + 1).trim();
        headers.push({ key, value, enabled: true });
      } else if (rawHeader.endsWith(';')) {
        // curl syntax for empty header: `-H "X-Custom;"`
        const key = rawHeader.slice(0, -1).trim();
        if (key) headers.push({ key, value: '', enabled: true });
      }
    } else if (token.startsWith('--header=')) {
      const rawHeader = token.slice('--header='.length);
      const colonIdx = rawHeader.indexOf(':');
      if (colonIdx !== -1) {
        headers.push({
          key: rawHeader.slice(0, colonIdx).trim(),
          value: rawHeader.slice(colonIdx + 1).trim(),
          enabled: true,
        });
      }
    } else if (token === '-u' || token === '--user') {
      const userPass = consumeValue();
      const colonIdx = userPass.indexOf(':');
      const username = colonIdx === -1 ? userPass : userPass.slice(0, colonIdx);
      const password = colonIdx === -1 ? '' : userPass.slice(colonIdx + 1);
      auth = {
        type: 'basic',
        basic: {
          username,
          password,
        },
      };
    } else if (token.startsWith('--user=')) {
      const userPass = token.slice('--user='.length);
      const colonIdx = userPass.indexOf(':');
      auth = {
        type: 'basic',
        basic: {
          username: colonIdx === -1 ? userPass : userPass.slice(0, colonIdx),
          password: colonIdx === -1 ? '' : userPass.slice(colonIdx + 1),
        },
      };
    } else if (
      token === '-d' ||
      token === '--data' ||
      token === '--data-raw' ||
      token === '--data-binary' ||
      token === '--data-ascii'
    ) {
      rawDataParts.push(consumeValue());
    } else if (
      token.startsWith('--data=') ||
      token.startsWith('--data-raw=') ||
      token.startsWith('--data-binary=') ||
      token.startsWith('--data-ascii=')
    ) {
      const eqIdx = token.indexOf('=');
      rawDataParts.push(token.slice(eqIdx + 1));
    } else if (token.startsWith('-d') && token.length > 2) {
      rawDataParts.push(token.slice(2));
    } else if (token === '--data-urlencode') {
      hasUrlEncodeFlag = true;
      urlEncodedEntries.push(parseUrlEncodedPair(consumeValue()));
    } else if (token.startsWith('--data-urlencode=')) {
      hasUrlEncodeFlag = true;
      urlEncodedEntries.push(
        parseUrlEncodedPair(token.slice('--data-urlencode='.length)),
      );
    } else if (token === '-F' || token === '--form') {
      formEntries.push(parseMultipartField(consumeValue(), false));
    } else if (token.startsWith('--form=')) {
      formEntries.push(parseMultipartField(token.slice('--form='.length), false));
    } else if (token === '--form-string') {
      formEntries.push(parseMultipartField(consumeValue(), true));
    } else if (token.startsWith('--form-string=')) {
      formEntries.push(
        parseMultipartField(token.slice('--form-string='.length), true),
      );
    } else if (token === '-A' || token === '--user-agent') {
      const ua = consumeValue();
      if (ua) headers.push({ key: 'User-Agent', value: ua, enabled: true });
    } else if (token === '-e' || token === '--referer') {
      const ref = consumeValue();
      if (ref) headers.push({ key: 'Referer', value: ref, enabled: true });
    } else if (token === '-b' || token === '--cookie') {
      const cookie = consumeValue();
      if (cookie) headers.push({ key: 'Cookie', value: cookie, enabled: true });
    } else if (token === '-G' || token === '--get') {
      forceGet = true;
    } else if (token === '-I' || token === '--head') {
      forceHead = true;
    } else if (token === '--compressed') {
      compressed = true;
    } else if (token === '-k' || token === '--insecure') {
      insecure = true;
    } else if (token === '-L' || token === '--location') {
      followRedirects = true;
    } else if (
      token === '-o' ||
      token === '--output' ||
      token === '-m' ||
      token === '--max-time' ||
      token === '--connect-timeout' ||
      token === '-x' ||
      token === '--proxy'
    ) {
      // Flags that take a value argument we can skip safely
      consumeValue();
    } else if (!token.startsWith('-')) {
      if (!rawUrl || looksLikeUrlCandidate(token)) {
        rawUrl = token;
      }
    }

    idx++;
  }

  if (!rawUrl) {
    throw new Error('No URL found in curl command');
  }

  if (
    !/^https?:\/\//i.test(rawUrl) &&
    !/^\{\{[^{}]+\}\}/.test(rawUrl)
  ) {
    rawUrl = `http://${rawUrl}`;
  }

  // Determine Content-Type header if present
  const contentTypeHeader = headers.find(
    h => h.key.toLowerCase() === 'content-type',
  )?.value?.toLowerCase() ?? '';

  // Determine body & method
  let body: RequestBodyConfig = { mode: 'none' };
  const hasBodyInput =
    rawDataParts.length > 0 || urlEncodedEntries.length > 0 || formEntries.length > 0;

  let queryParams = syncQueryParamsFromUrl(rawUrl, []);

  if (forceGet && (rawDataParts.length > 0 || urlEncodedEntries.length > 0)) {
    const extraPairs: QueryParamEntry[] = [
      ...rawDataParts.flatMap(parseUrlEncodedString),
      ...urlEncodedEntries,
    ];
    queryParams = [...queryParams, ...extraPairs];
    rawUrl = syncUrlFromQueryParams(rawUrl, queryParams);
  } else if (formEntries.length > 0) {
    body = {
      mode: 'multipart-form',
      formData: formEntries,
    };
  } else if (hasUrlEncodeFlag) {
    const combinedEntries = [
      ...rawDataParts.flatMap(parseUrlEncodedString),
      ...urlEncodedEntries,
    ];
    body = {
      mode: 'form-urlencoded',
      urlEncoded: combinedEntries,
    };
  } else if (rawDataParts.length > 0) {
    const joinedData = rawDataParts.join('&');
    if (contentTypeHeader.includes('application/x-www-form-urlencoded')) {
      body = {
        mode: 'form-urlencoded',
        urlEncoded: parseUrlEncodedString(joinedData),
        content: joinedData,
      };
    } else if (contentTypeHeader.includes('json') || looksLikeJson(joinedData)) {
      let formattedJson = joinedData;
      try {
        formattedJson = JSON.stringify(JSON.parse(joinedData), null, 2);
      } catch {
        // preserve raw string if invalid JSON with application/json header
      }
      body = {
        mode: 'json',
        content: formattedJson,
      };
    } else if (contentTypeHeader.includes('xml')) {
      body = {
        mode: 'xml',
        content: joinedData,
      };
    } else if (contentTypeHeader.includes('yaml') || contentTypeHeader.includes('yml')) {
      body = {
        mode: 'yaml',
        content: joinedData,
      };
    } else if (contentTypeHeader.includes('html')) {
      body = {
        mode: 'html',
        content: joinedData,
      };
    } else {
      body = {
        mode: 'text',
        content: joinedData,
      };
    }
  }

  let method: HttpMethod = 'GET';
  if (explicitMethod) {
    method = explicitMethod;
  } else if (forceHead) {
    method = 'HEAD';
  } else if (forceGet) {
    method = 'GET';
  } else if (hasBodyInput) {
    method = 'POST';
  }

  const pathParams = syncPathParamsFromUrl(rawUrl, []);

  return {
    method,
    url: rawUrl,
    queryParams,
    pathParams,
    headers,
    auth,
    body,
    ...(compressed ? { compressed: true } : {}),
    ...(insecure ? { insecure: true } : {}),
    ...(followRedirects ? { followRedirects: true } : {}),
  };
}

/**
 * Converts a `curl` command string directly into an AwapiLasso `RequestItem`,
 * optionally merging into an existing request item (preserving its ID, name, captures, assertions).
 */
export function curlToRequestItem(
  command: string,
  existing?: Partial<RequestItem>,
): RequestItem {
  const parsed = parseCurlCommand(command);
  let name = existing?.name;
  if (!name || name === 'New HTTP Request' || name === 'Health Check') {
    try {
      const urlForName = parsed.url.replace(/\{\{[^{}]+\}\}/g, 'http://placeholder.local');
      const parsedUrl = new URL(urlForName);
      name = `${parsed.method} ${parsedUrl.pathname || '/'}`;
    } catch {
      name = `${parsed.method} Request`;
    }
  }

  return createDefaultHttpRequest({
    ...existing,
    name,
    protocol: 'http',
    method: parsed.method,
    url: parsed.url,
    queryParams: parsed.queryParams,
    pathParams: parsed.pathParams,
    headers: parsed.headers,
    auth: parsed.auth,
    body: parsed.body,
  });
}
