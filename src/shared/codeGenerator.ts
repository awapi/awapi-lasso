import type {
  AuthConfig,
  AuthProfile,
  FormDataEntry,
  KeyValueEntry,
  PathParamEntry,
  QueryParamEntry,
  RequestItem,
} from './collectionSchema';
import {
  interpolateText,
  type VariableInterpolationContext,
} from './interpolation';
import { splitUrlParts, syncQueryParamsFromUrl } from './urlParams';

export type CodeGeneratorTarget =
  | 'curl-bash'
  | 'curl-powershell'
  | 'js-fetch'
  | 'js-axios'
  | 'python-requests'
  | 'python-httpx'
  | 'go-net-http'
  | 'csharp-httpclient'
  | 'rust-reqwest';

export interface CodeGeneratorTargetMeta {
  id: CodeGeneratorTarget;
  label: string;
  language: string;
}

export const CODE_GENERATOR_TARGETS: CodeGeneratorTargetMeta[] = [
  { id: 'curl-bash', label: 'cURL (Bash)', language: 'shell' },
  { id: 'curl-powershell', label: 'cURL (PowerShell)', language: 'powershell' },
  { id: 'js-fetch', label: 'JavaScript / TS (fetch)', language: 'typescript' },
  { id: 'js-axios', label: 'JavaScript / TS (axios)', language: 'typescript' },
  { id: 'python-requests', label: 'Python (requests)', language: 'python' },
  { id: 'python-httpx', label: 'Python (httpx)', language: 'python' },
  { id: 'go-net-http', label: 'Go (net/http)', language: 'go' },
  { id: 'csharp-httpclient', label: 'C# (HttpClient)', language: 'csharp' },
  { id: 'rust-reqwest', label: 'Rust (reqwest)', language: 'rust' },
];

export interface GenerateCodeSnippetOptions {
  request: RequestItem;
  target: CodeGeneratorTarget;
  /** When true, interpolates `{{variables}}` using `interpolationContext`. When false, preserves `{{variables}}`. */
  resolveVariables?: boolean;
  interpolationContext?: VariableInterpolationContext;
  inheritedHeaders?: KeyValueEntry[];
  collectionDefaultAuth?: AuthConfig;
  authProfiles?: AuthProfile[];
}

export interface PreparedSnippetData {
  method: string;
  url: string;
  headers: Array<{ key: string; value: string }>;
  basicAuth?: { username: string; password: string };
  bodyKind: 'none' | 'raw' | 'urlencoded' | 'multipart';
  rawBody?: string;
  urlEncoded?: Array<{ key: string; value: string }>;
  multipart?: FormDataEntry[];
}

function maybeResolve(
  text: string,
  resolveVariables: boolean,
  context: VariableInterpolationContext,
): string {
  if (!text) return '';
  return resolveVariables ? interpolateText(text, context) : text;
}

function encodePartPreservingVars(val: string, resolveVariables: boolean): string {
  if (resolveVariables) {
    return encodeURIComponent(val);
  }
  return val
    .split(/(\{\{[^{}]+\}\})/g)
    .map(seg => (seg.startsWith('{{') && seg.endsWith('}}') ? seg : encodeURIComponent(seg)))
    .join('');
}

function buildSnippetUrl(
  rawUrl: string,
  queryParams: QueryParamEntry[] | undefined,
  pathParams: PathParamEntry[] | undefined,
  extraQuery: Array<{ key: string; value: string }>,
  resolveVariables: boolean,
  context: VariableInterpolationContext,
): string {
  const { basePath, hash } = splitUrlParts(rawUrl);
  const effectiveQuery =
    queryParams !== undefined ? queryParams : syncQueryParamsFromUrl(rawUrl, []);

  const pathMap = new Map<string, string>();
  for (const pp of pathParams ?? []) {
    if (pp.key && pp.value !== undefined && pp.value !== '') {
      pathMap.set(pp.key, maybeResolve(pp.value, resolveVariables, context));
    }
  }

  // Mask {{...}} tokens so single-brace {param} substitution ignores variables
  const tokenPlaceholders: string[] = [];
  const maskedBase = basePath.replace(/\{\{[^{}]+\}\}/g, token => {
    const idx = tokenPlaceholders.length;
    tokenPlaceholders.push(token);
    return `__AWJC_TOKEN_${idx}__`;
  });

  const authorityMatch = maskedBase.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+)(.*)$/);
  const authorityPrefix = authorityMatch ? authorityMatch[1] : '';
  const pathSegment = authorityMatch ? authorityMatch[2] : maskedBase;

  const substitutedPath = pathSegment
    .replace(/\/:([a-zA-Z_][a-zA-Z0-9_-]*)/g, (full, name: string) => {
      const val = pathMap.get(name);
      return val !== undefined ? `/${encodePartPreservingVars(val, resolveVariables)}` : full;
    })
    .replace(/\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/g, (full, name: string) => {
      const val = pathMap.get(name);
      return val !== undefined ? encodePartPreservingVars(val, resolveVariables) : full;
    });

  const restoredBase = `${authorityPrefix}${substitutedPath}`.replace(
    /__AWJC_TOKEN_(\d+)__/g,
    (_, idxStr: string) => tokenPlaceholders[Number(idxStr)] ?? '',
  );

  const finalBase = maybeResolve(restoredBase, resolveVariables, context);

  const enabledQueries = [
    ...effectiveQuery
      .filter(q => q.enabled !== false && q.key.trim().length > 0)
      .map(q => ({
        key: maybeResolve(q.key.trim(), resolveVariables, context),
        value: maybeResolve(q.value ?? '', resolveVariables, context),
      })),
    ...extraQuery,
  ];

  if (enabledQueries.length === 0) {
    return `${finalBase}${hash}`;
  }

  const qs = enabledQueries
    .map(
      q =>
        `${encodePartPreservingVars(q.key, resolveVariables)}=${encodePartPreservingVars(
          q.value,
          resolveVariables,
        )}`,
    )
    .join('&');

  return `${finalBase}?${qs}${hash}`;
}

function resolveEffectiveAuthConfig(
  auth: AuthConfig | undefined,
  collectionDefaultAuth: AuthConfig | undefined,
  authProfiles: AuthProfile[] | undefined,
): AuthConfig {
  let effective = auth ?? { type: 'inherit' };
  if (effective.type === 'inherit') {
    effective = collectionDefaultAuth ?? { type: 'none' };
  }
  if (effective.type === 'profile' && effective.profileId && Array.isArray(authProfiles)) {
    const matched = authProfiles.find(p => p.id === effective.profileId);
    if (matched) {
      effective = matched;
    }
  }
  return effective;
}

function encodeBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf-8').toString('base64');
  }
  return btoa(text);
}

/**
 * Prepares the normalized URL, headers, auth, and body payload for code generation.
 */
export function prepareSnippetData(options: GenerateCodeSnippetOptions): PreparedSnippetData {
  const {
    request,
    resolveVariables = false,
    interpolationContext = {},
    inheritedHeaders = [],
    collectionDefaultAuth,
    authProfiles,
  } = options;

  const method =
    request.protocol === 'graphql' ? 'POST' : (request.method || 'GET').toUpperCase();

  // Merge inherited headers + request headers
  const headerMap = new Map<string, { key: string; value: string }>();
  for (const h of [...inheritedHeaders, ...(request.headers ?? [])]) {
    if (!h || h.enabled === false || !h.key.trim()) continue;
    const k = maybeResolve(h.key.trim(), resolveVariables, interpolationContext);
    const v = maybeResolve(h.value ?? '', resolveVariables, interpolationContext);
    headerMap.set(k.toLowerCase(), { key: k, value: v });
  }

  const effectiveAuth = resolveEffectiveAuthConfig(
    request.auth,
    collectionDefaultAuth,
    authProfiles,
  );
  const extraQuery: Array<{ key: string; value: string }> = [];
  let basicAuth: { username: string; password: string } | undefined;

  if (effectiveAuth.type === 'bearer' && effectiveAuth.bearer) {
    const prefix = effectiveAuth.bearer.prefix?.trim() || 'Bearer';
    const token = maybeResolve(
      effectiveAuth.bearer.token ?? '',
      resolveVariables,
      interpolationContext,
    );
    if (!headerMap.has('authorization')) {
      headerMap.set('authorization', {
        key: 'Authorization',
        value: `${prefix} ${token}`,
      });
    }
  } else if (effectiveAuth.type === 'basic' && effectiveAuth.basic) {
    const username = maybeResolve(
      effectiveAuth.basic.username ?? '',
      resolveVariables,
      interpolationContext,
    );
    const password = maybeResolve(
      effectiveAuth.basic.password ?? '',
      resolveVariables,
      interpolationContext,
    );
    basicAuth = { username, password };
  } else if (effectiveAuth.type === 'apikey' && effectiveAuth.apikey) {
    const key = maybeResolve(
      effectiveAuth.apikey.key ?? '',
      resolveVariables,
      interpolationContext,
    );
    const value = maybeResolve(
      effectiveAuth.apikey.value ?? '',
      resolveVariables,
      interpolationContext,
    );
    if (key) {
      if (effectiveAuth.apikey.in === 'query') {
        extraQuery.push({ key, value });
      } else if (!headerMap.has(key.toLowerCase())) {
        headerMap.set(key.toLowerCase(), { key, value });
      }
    }
  } else if (effectiveAuth.type === 'oauth2' && effectiveAuth.oauth2) {
    const prefix = effectiveAuth.oauth2.tokenHeaderPrefix?.trim() || 'Bearer';
    if (!headerMap.has('authorization')) {
      headerMap.set('authorization', {
        key: 'Authorization',
        value: `${prefix} {{oauthAccessToken}}`,
      });
    }
  }

  const url = buildSnippetUrl(
    request.url,
    request.queryParams,
    request.pathParams,
    extraQuery,
    resolveVariables,
    interpolationContext,
  );

  // Body handling
  let bodyKind: PreparedSnippetData['bodyKind'] = 'none';
  let rawBody: string | undefined;
  let urlEncoded: Array<{ key: string; value: string }> | undefined;
  let multipart: FormDataEntry[] | undefined;

  if (request.protocol === 'graphql') {
    if (!headerMap.has('content-type')) {
      headerMap.set('content-type', { key: 'Content-Type', value: 'application/json' });
    }
    const queryStr = maybeResolve(
      request.graphql?.query ?? '',
      resolveVariables,
      interpolationContext,
    );
    const opName = maybeResolve(
      request.graphql?.operationName ?? '',
      resolveVariables,
      interpolationContext,
    ).trim();
    const varsStr = maybeResolve(
      request.graphql?.variables ?? '',
      resolveVariables,
      interpolationContext,
    ).trim();

    let parsedVars: unknown = undefined;
    if (varsStr) {
      try {
        parsedVars = JSON.parse(varsStr);
      } catch {
        parsedVars = varsStr;
      }
    }

    const payload: Record<string, unknown> = { query: queryStr };
    if (opName) payload.operationName = opName;
    if (
      parsedVars !== undefined &&
      !(
        typeof parsedVars === 'object' &&
        parsedVars !== null &&
        Object.keys(parsedVars).length === 0
      )
    ) {
      payload.variables = parsedVars;
    }

    bodyKind = 'raw';
    rawBody = JSON.stringify(payload, null, 2);
  } else if (request.body && request.body.mode !== 'none') {
    const mode = request.body.mode;
    if (mode === 'form-urlencoded') {
      bodyKind = 'urlencoded';
      urlEncoded = (request.body.urlEncoded ?? [])
        .filter(e => e.enabled !== false && e.key.trim().length > 0)
        .map(e => ({
          key: maybeResolve(e.key.trim(), resolveVariables, interpolationContext),
          value: maybeResolve(e.value ?? '', resolveVariables, interpolationContext),
        }));
      if (!headerMap.has('content-type')) {
        headerMap.set('content-type', {
          key: 'Content-Type',
          value: 'application/x-www-form-urlencoded',
        });
      }
    } else if (mode === 'multipart-form') {
      bodyKind = 'multipart';
      multipart = (request.body.formData ?? [])
        .filter(f => f.enabled !== false && f.key.trim().length > 0)
        .map(f => ({
          ...f,
          key: maybeResolve(f.key.trim(), resolveVariables, interpolationContext),
          value:
            f.value !== undefined
              ? maybeResolve(f.value, resolveVariables, interpolationContext)
              : undefined,
        }));
    } else if (
      mode === 'json' ||
      mode === 'yaml' ||
      mode === 'xml' ||
      mode === 'html' ||
      mode === 'text'
    ) {
      bodyKind = 'raw';
      rawBody = maybeResolve(
        request.body.content ?? '',
        resolveVariables,
        interpolationContext,
      );
      if (!headerMap.has('content-type')) {
        const defaultMime =
          mode === 'json'
            ? 'application/json'
            : mode === 'yaml'
              ? 'application/x-yaml'
              : mode === 'xml'
                ? 'application/xml'
                : mode === 'html'
                  ? 'text/html'
                  : 'text/plain';
        headerMap.set('content-type', { key: 'Content-Type', value: defaultMime });
      }
    }
  }

  return {
    method,
    url,
    headers: Array.from(headerMap.values()),
    ...(basicAuth ? { basicAuth } : {}),
    bodyKind,
    rawBody,
    urlEncoded,
    multipart,
  };
}

function escapeBashSingleQuote(val: string): string {
  return `'${val.replace(/'/g, `'\\''`)}'`;
}

function escapePowerShellSingleQuote(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

function generateCurlBash(data: PreparedSnippetData): string {
  const lines: string[] = [`curl -X ${data.method} ${escapeBashSingleQuote(data.url)}`];

  if (data.basicAuth) {
    lines.push(
      `  -u ${escapeBashSingleQuote(`${data.basicAuth.username}:${data.basicAuth.password}`)}`,
    );
  }

  for (const h of data.headers) {
    lines.push(`  -H ${escapeBashSingleQuote(`${h.key}: ${h.value}`)}`);
  }

  if (data.bodyKind === 'raw' && data.rawBody !== undefined) {
    lines.push(`  --data-raw ${escapeBashSingleQuote(data.rawBody)}`);
  } else if (data.bodyKind === 'urlencoded' && data.urlEncoded) {
    for (const pair of data.urlEncoded) {
      lines.push(
        `  --data-urlencode ${escapeBashSingleQuote(`${pair.key}=${pair.value}`)}`,
      );
    }
  } else if (data.bodyKind === 'multipart' && data.multipart) {
    for (const field of data.multipart) {
      if (field.type === 'file') {
        const suffix = field.contentType ? `;type=${field.contentType}` : '';
        lines.push(
          `  -F ${escapeBashSingleQuote(`${field.key}=@${field.filePath ?? 'file'}${suffix}`)}`,
        );
      } else {
        lines.push(`  -F ${escapeBashSingleQuote(`${field.key}=${field.value ?? ''}`)}`);
      }
    }
  }

  return lines.join(' \\\n');
}

function generateCurlPowerShell(data: PreparedSnippetData): string {
  const lines: string[] = [
    `curl.exe -X ${data.method} ${escapePowerShellSingleQuote(data.url)}`,
  ];

  if (data.basicAuth) {
    lines.push(
      `  -u ${escapePowerShellSingleQuote(`${data.basicAuth.username}:${data.basicAuth.password}`)}`,
    );
  }

  for (const h of data.headers) {
    lines.push(`  -H ${escapePowerShellSingleQuote(`${h.key}: ${h.value}`)}`);
  }

  if (data.bodyKind === 'raw' && data.rawBody !== undefined) {
    lines.push(`  --data-raw ${escapePowerShellSingleQuote(data.rawBody)}`);
  } else if (data.bodyKind === 'urlencoded' && data.urlEncoded) {
    for (const pair of data.urlEncoded) {
      lines.push(
        `  --data-urlencode ${escapePowerShellSingleQuote(`${pair.key}=${pair.value}`)}`,
      );
    }
  } else if (data.bodyKind === 'multipart' && data.multipart) {
    for (const field of data.multipart) {
      if (field.type === 'file') {
        lines.push(
          `  -F ${escapePowerShellSingleQuote(`${field.key}=@${field.filePath ?? 'file'}`)}`,
        );
      } else {
        lines.push(
          `  -F ${escapePowerShellSingleQuote(`${field.key}=${field.value ?? ''}`)}`,
        );
      }
    }
  }

  return lines.join(' `\n');
}

function withBasicAuthHeader(
  data: PreparedSnippetData,
): Array<{ key: string; value: string }> {
  const list = [...data.headers];
  if (
    data.basicAuth &&
    !list.some(h => h.key.toLowerCase() === 'authorization')
  ) {
    const encoded = encodeBase64(
      `${data.basicAuth.username}:${data.basicAuth.password}`,
    );
    list.push({ key: 'Authorization', value: `Basic ${encoded}` });
  }
  return list;
}

function generateJsFetch(data: PreparedSnippetData): string {
  const headers = withBasicAuthHeader(data);
  const lines: string[] = [];

  if (data.bodyKind === 'multipart' && data.multipart) {
    lines.push('const form = new FormData();');
    for (const f of data.multipart) {
      lines.push(
        `form.append(${JSON.stringify(f.key)}, ${JSON.stringify(
          f.type === 'file' ? f.filePath ?? '' : f.value ?? '',
        )});`,
      );
    }
    lines.push('');
  }

  lines.push(`const response = await fetch(${JSON.stringify(data.url)}, {`);
  lines.push(`  method: ${JSON.stringify(data.method)},`);

  if (headers.length > 0) {
    lines.push('  headers: {');
    for (const h of headers) {
      lines.push(`    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)},`);
    }
    lines.push('  },');
  }

  if (data.bodyKind === 'raw' && data.rawBody !== undefined) {
    lines.push(`  body: ${JSON.stringify(data.rawBody)},`);
  } else if (data.bodyKind === 'urlencoded' && data.urlEncoded) {
    const pairs = data.urlEncoded.map(p => [p.key, p.value]);
    lines.push(`  body: new URLSearchParams(${JSON.stringify(pairs)}),`);
  } else if (data.bodyKind === 'multipart') {
    lines.push('  body: form,');
  }

  lines.push('});');
  lines.push('');
  lines.push('const data = await response.json();');
  lines.push('console.log(response.status, data);');
  return lines.join('\n');
}

function generateJsAxios(data: PreparedSnippetData): string {
  const lines: string[] = ["import axios from 'axios';", ''];
  lines.push('const response = await axios.request({');
  lines.push(`  method: ${JSON.stringify(data.method)},`);
  lines.push(`  url: ${JSON.stringify(data.url)},`);

  if (data.headers.length > 0) {
    lines.push('  headers: {');
    for (const h of data.headers) {
      lines.push(`    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)},`);
    }
    lines.push('  },');
  }

  if (data.basicAuth) {
    lines.push('  auth: {');
    lines.push(`    username: ${JSON.stringify(data.basicAuth.username)},`);
    lines.push(`    password: ${JSON.stringify(data.basicAuth.password)},`);
    lines.push('  },');
  }

  if (data.bodyKind === 'raw' && data.rawBody !== undefined) {
    try {
      const parsed = JSON.parse(data.rawBody);
      lines.push(`  data: ${JSON.stringify(parsed, null, 2).replace(/\n/g, '\n  ')},`);
    } catch {
      lines.push(`  data: ${JSON.stringify(data.rawBody)},`);
    }
  } else if (data.bodyKind === 'urlencoded' && data.urlEncoded) {
    const pairs = data.urlEncoded.map(p => [p.key, p.value]);
    lines.push(`  data: new URLSearchParams(${JSON.stringify(pairs)}),`);
  }

  lines.push('});');
  lines.push('');
  lines.push('console.log(response.status, response.data);');
  return lines.join('\n');
}

function generatePythonSnippet(
  data: PreparedSnippetData,
  library: 'requests' | 'httpx',
): string {
  const lines: string[] = [`import ${library}`, ''];
  lines.push(`url = ${JSON.stringify(data.url)}`);

  if (data.headers.length > 0) {
    lines.push('headers = {');
    for (const h of data.headers) {
      lines.push(`    ${JSON.stringify(h.key)}: ${JSON.stringify(h.value)},`);
    }
    lines.push('}');
  }

  let bodyArg = '';
  if (data.bodyKind === 'raw' && data.rawBody !== undefined) {
    lines.push(`payload = ${JSON.stringify(data.rawBody)}`);
    bodyArg = ', content=payload' === `, content=payload` && library === 'httpx'
      ? ', content=payload'
      : ', data=payload';
  } else if (data.bodyKind === 'urlencoded' && data.urlEncoded) {
    lines.push('payload = {');
    for (const p of data.urlEncoded) {
      lines.push(`    ${JSON.stringify(p.key)}: ${JSON.stringify(p.value)},`);
    }
    lines.push('}');
    bodyArg = ', data=payload';
  }

  const headersArg = data.headers.length > 0 ? ', headers=headers' : '';
  const authArg = data.basicAuth
    ? `, auth=(${JSON.stringify(data.basicAuth.username)}, ${JSON.stringify(
        data.basicAuth.password,
      )})`
    : '';

  lines.push('');
  lines.push(
    `response = ${library}.request(${JSON.stringify(
      data.method,
    )}, url${headersArg}${authArg}${bodyArg})`,
  );
  lines.push('print(response.status_code)');
  lines.push('print(response.text)');
  return lines.join('\n');
}

function getSerializedBodyString(data: PreparedSnippetData): string | undefined {
  if (data.bodyKind === 'raw' && data.rawBody !== undefined) {
    return data.rawBody;
  }
  if (data.bodyKind === 'urlencoded' && data.urlEncoded) {
    return data.urlEncoded
      .map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
      .join('&');
  }
  return undefined;
}

function generateGoNetHttp(data: PreparedSnippetData): string {
  const bodyStr = getSerializedBodyString(data);
  const imports = ['"fmt"', '"io"', '"net/http"'];
  if (bodyStr !== undefined) {
    imports.push('"strings"');
  }

  const lines: string[] = [
    'package main',
    '',
    'import (',
    ...imports.sort().map(i => `\t${i}`),
    ')',
    '',
    'func main() {',
  ];

  if (bodyStr !== undefined) {
    lines.push(`\tpayload := strings.NewReader(${JSON.stringify(bodyStr)})`);
    lines.push(
      `\treq, err := http.NewRequest(${JSON.stringify(data.method)}, ${JSON.stringify(
        data.url,
      )}, payload)`,
    );
  } else {
    lines.push(
      `\treq, err := http.NewRequest(${JSON.stringify(data.method)}, ${JSON.stringify(
        data.url,
      )}, nil)`,
    );
  }

  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');

  if (data.basicAuth) {
    lines.push(
      `\treq.SetBasicAuth(${JSON.stringify(data.basicAuth.username)}, ${JSON.stringify(
        data.basicAuth.password,
      )})`,
    );
  }

  for (const h of data.headers) {
    lines.push(`\treq.Header.Set(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`);
  }

  lines.push('');
  lines.push('\tres, err := http.DefaultClient.Do(req)');
  lines.push('\tif err != nil {');
  lines.push('\t\tpanic(err)');
  lines.push('\t}');
  lines.push('\tdefer res.Body.Close()');
  lines.push('\tbody, _ := io.ReadAll(res.Body)');
  lines.push('\tfmt.Println(res.Status)');
  lines.push('\tfmt.Println(string(body))');
  lines.push('}');
  return lines.join('\n');
}

function generateCSharpHttpClient(data: PreparedSnippetData): string {
  const headers = withBasicAuthHeader(data);
  const bodyStr = getSerializedBodyString(data);
  const contentType =
    headers.find(h => h.key.toLowerCase() === 'content-type')?.value ?? 'application/json';

  const lines: string[] = [
    'using System;',
    'using System.Net.Http;',
    'using System.Text;',
    '',
    'using var client = new HttpClient();',
    `using var request = new HttpRequestMessage(new HttpMethod(${JSON.stringify(
      data.method,
    )}), ${JSON.stringify(data.url)});`,
  ];

  for (const h of headers) {
    if (h.key.toLowerCase() === 'content-type' && bodyStr !== undefined) continue;
    lines.push(
      `request.Headers.TryAddWithoutValidation(${JSON.stringify(h.key)}, ${JSON.stringify(
        h.value,
      )});`,
    );
  }

  if (bodyStr !== undefined) {
    lines.push(
      `request.Content = new StringContent(${JSON.stringify(
        bodyStr,
      )}, Encoding.UTF8, ${JSON.stringify(contentType)});`,
    );
  }

  lines.push('');
  lines.push('using var response = await client.SendAsync(request);');
  lines.push('var responseBody = await response.Content.ReadAsStringAsync();');
  lines.push('Console.WriteLine((int)response.StatusCode);');
  lines.push('Console.WriteLine(responseBody);');
  return lines.join('\n');
}

function generateRustReqwest(data: PreparedSnippetData): string {
  const bodyStr = getSerializedBodyString(data);
  const lines: string[] = [
    '#[tokio::main]',
    'async fn main() -> Result<(), Box<dyn std::error::Error>> {',
    '    let client = reqwest::Client::new();',
    `    let response = client`,
    `        .request(reqwest::Method::from_bytes(b${JSON.stringify(
      data.method,
    )})?, ${JSON.stringify(data.url)})`,
  ];

  if (data.basicAuth) {
    lines.push(
      `        .basic_auth(${JSON.stringify(
        data.basicAuth.username,
      )}, Some(${JSON.stringify(data.basicAuth.password)}))`,
    );
  }

  for (const h of data.headers) {
    lines.push(`        .header(${JSON.stringify(h.key)}, ${JSON.stringify(h.value)})`);
  }

  if (bodyStr !== undefined) {
    lines.push(`        .body(${JSON.stringify(bodyStr)})`);
  }

  lines.push('        .send()');
  lines.push('        .await?;');
  lines.push('');
  lines.push('    println!("Status: {}", response.status());');
  lines.push('    println!("{}", response.text().await?);');
  lines.push('    Ok(())');
  lines.push('}');
  return lines.join('\n');
}

/**
 * Generates a ready-to-copy code snippet for the given HTTP or GraphQL request.
 */
export function generateCodeSnippet(options: GenerateCodeSnippetOptions): string {
  const data = prepareSnippetData(options);

  switch (options.target) {
    case 'curl-bash':
      return generateCurlBash(data);
    case 'curl-powershell':
      return generateCurlPowerShell(data);
    case 'js-fetch':
      return generateJsFetch(data);
    case 'js-axios':
      return generateJsAxios(data);
    case 'python-requests':
      return generatePythonSnippet(data, 'requests');
    case 'python-httpx':
      return generatePythonSnippet(data, 'httpx');
    case 'go-net-http':
      return generateGoNetHttp(data);
    case 'csharp-httpclient':
      return generateCSharpHttpClient(data);
    case 'rust-reqwest':
      return generateRustReqwest(data);
  }
}
