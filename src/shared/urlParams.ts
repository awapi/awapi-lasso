import type { PathParamEntry, QueryParamEntry } from './collectionSchema';
import { interpolateText, type VariableInterpolationContext } from './interpolation';

/**
 * Splits a URL into `{ basePath, queryString, hash }` without corrupting `{{variable}}` tokens.
 */
export function splitUrlParts(rawUrl: string): {
  basePath: string;
  queryString: string;
  hash: string;
} {
  let hash = '';
  let withoutHash = rawUrl;
  const hashIdx = rawUrl.indexOf('#');
  if (hashIdx !== -1) {
    hash = rawUrl.slice(hashIdx);
    withoutHash = rawUrl.slice(0, hashIdx);
  }

  const qIdx = withoutHash.indexOf('?');
  if (qIdx === -1) {
    return { basePath: withoutHash, queryString: '', hash };
  }

  return {
    basePath: withoutHash.slice(0, qIdx),
    queryString: withoutHash.slice(qIdx + 1),
    hash,
  };
}

function safeDecodeParamComponent(str: string): string {
  // Preserve {{variable}} tokens verbatim while decoding percent-encoded characters outside tokens
  try {
    return decodeURIComponent(str.replace(/\+/g, '%20'));
  } catch {
    return str;
  }
}

function encodeQueryPartPreservingVariables(value: string): string {
  // Split around {{...}} tokens so variables stay unescaped in the URL bar
  const parts = value.split(/(\{\{[^{}]+\}\})/g);
  return parts
    .map(part => {
      if (part.startsWith('{{') && part.endsWith('}}')) {
        return part;
      }
      return encodeURIComponent(part);
    })
    .join('');
}

/**
 * Parses the query string from `rawUrl` and synchronizes it with `existingParams`:
 * - Enabled rows come from the URL query string in order (preserving descriptions/secret flags when matched).
 * - Disabled rows (`enabled: false`) from `existingParams` are retained in their relative positions.
 */
export function syncQueryParamsFromUrl(
  rawUrl: string,
  existingParams: QueryParamEntry[] = [],
): QueryParamEntry[] {
  const { queryString } = splitUrlParts(rawUrl);
  const disabledExisting = existingParams.filter(p => p.enabled === false);
  const enabledExistingPool = existingParams.filter(p => p.enabled !== false);

  if (!queryString) {
    return disabledExisting.map(p => ({ ...p }));
  }

  const rawPairs = queryString.split('&').filter(seg => seg.length > 0);
  const usedIndices = new Set<number>();

  const parsedEnabled: QueryParamEntry[] = rawPairs.map(pair => {
    const eqIdx = pair.indexOf('=');
    const rawKey = eqIdx === -1 ? pair : pair.slice(0, eqIdx);
    const rawVal = eqIdx === -1 ? '' : pair.slice(eqIdx + 1);
    const key = safeDecodeParamComponent(rawKey);
    const value = safeDecodeParamComponent(rawVal);

    const matchIdx = enabledExistingPool.findIndex(
      (existing, idx) => !usedIndices.has(idx) && existing.key === key,
    );
    if (matchIdx !== -1) {
      usedIndices.add(matchIdx);
      const matched = enabledExistingPool[matchIdx];
      return {
        ...matched,
        key,
        value,
        enabled: true,
      };
    }

    return {
      key,
      value,
      enabled: true,
    };
  });

  return [...parsedEnabled, ...disabledExisting.map(p => ({ ...p }))];
}

/**
 * Updates `rawUrl`'s query string from the `queryParams` table (including only `enabled: true` rows
 * with a non-empty key) while preserving `{{variable}}` tokens unescaped in the URL bar.
 */
export function syncUrlFromQueryParams(
  rawUrl: string,
  queryParams: QueryParamEntry[],
): string {
  const { basePath, hash } = splitUrlParts(rawUrl);
  const enabled = queryParams.filter(p => p.enabled !== false && p.key.trim().length > 0);
  if (enabled.length === 0) {
    return `${basePath}${hash}`;
  }

  const queryStr = enabled
    .map(p => {
      const k = encodeQueryPartPreservingVariables(p.key);
      const v = p.value !== undefined ? encodeQueryPartPreservingVariables(p.value) : '';
      return `${k}=${v}`;
    })
    .join('&');

  return `${basePath}?${queryStr}${hash}`;
}

/**
 * Extracts path parameter names from a URL path supporting both `:paramName`
 * (excluding port numbers like `:8080` after host) and single-brace `{paramName}`
 * (excluding double-brace `{{variable}}` interpolation tokens).
 */
export function extractPathParamNames(rawUrl: string): string[] {
  const { basePath } = splitUrlParts(rawUrl);
  // Temporarily mask {{...}} tokens so single-brace {param} matching never matches {{variable}}
  const masked = basePath.replace(/\{\{[^{}]*\}\}/g, '__AWJC_VAR__');

  // Strip scheme + authority (e.g. https://localhost:8080) so `:8080` is not treated as a path param
  const pathOnly = masked.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+/, '');

  const names: string[] = [];
  const seen = new Set<string>();

  const regex = /(?:\/:([a-zA-Z_][a-zA-Z0-9_-]*))|\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(pathOnly)) !== null) {
    const name = match[1] || match[2];
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

/**
 * Synchronizes `pathParams` with the `:param` / `{param}` placeholders currently present in `rawUrl`,
 * preserving existing values and descriptions for matching parameter keys.
 */
export function syncPathParamsFromUrl(
  rawUrl: string,
  existingPathParams: PathParamEntry[] = [],
): PathParamEntry[] {
  const names = extractPathParamNames(rawUrl);
  const byKey = new Map<string, PathParamEntry>();
  for (const entry of existingPathParams) {
    if (entry.key) byKey.set(entry.key, entry);
  }

  return names.map(key => {
    const prev = byKey.get(key);
    return prev
      ? { ...prev, key }
      : {
          key,
          value: '',
        };
  });
}

export interface BuildResolvedUrlOptions {
  rawUrl: string;
  queryParams?: QueryParamEntry[];
  pathParams?: PathParamEntry[];
  context?: VariableInterpolationContext;
}

/**
 * Builds the final resolved URL for outbound HTTP/GraphQL execution:
 * 1. Strips inline query string from `rawUrl` when `queryParams` are provided (or merges if `queryParams` omitted).
 * 2. Substitutes `:paramName` and `{paramName}` segments using `pathParams` (with `{{variable}}` interpolation).
 * 3. Interpolates `{{variables}}` in the base URL path.
 * 4. Interpolates and URL-encodes enabled `queryParams` and appends them to the URL.
 */
export function buildResolvedRequestUrl(options: BuildResolvedUrlOptions): string {
  const { rawUrl, queryParams, pathParams = [], context = {} } = options;
  const { basePath, hash } = splitUrlParts(rawUrl);

  const effectiveQueryParams =
    queryParams !== undefined ? queryParams : syncQueryParamsFromUrl(rawUrl, []);

  // Build path param lookup with interpolated values
  const pathMap = new Map<string, string>();
  for (const pp of pathParams) {
    if (pp.key && pp.value !== undefined && pp.value !== '') {
      pathMap.set(pp.key, interpolateText(pp.value, context));
    }
  }

  // Temporarily protect {{...}} tokens while substituting :param and {param}
  const tokenPlaceholders: string[] = [];
  const maskedBase = basePath.replace(/\{\{[^{}]+\}\}/g, token => {
    const idx = tokenPlaceholders.length;
    tokenPlaceholders.push(token);
    return `__AWJC_TOKEN_${idx}__`;
  });

  // Separate scheme+authority from path so :port is untouched
  const authorityMatch = maskedBase.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]+)(.*)$/);
  const authorityPrefix = authorityMatch ? authorityMatch[1] : '';
  const pathSegment = authorityMatch ? authorityMatch[2] : maskedBase;

  const substitutedPath = pathSegment
    .replace(/\/:([a-zA-Z_][a-zA-Z0-9_-]*)/g, (full, name: string) => {
      const val = pathMap.get(name);
      return val !== undefined ? `/${encodeURIComponent(val)}` : full;
    })
    .replace(/\{([a-zA-Z_][a-zA-Z0-9_-]*)\}/g, (full, name: string) => {
      const val = pathMap.get(name);
      return val !== undefined ? encodeURIComponent(val) : full;
    });

  const restoredBase = `${authorityPrefix}${substitutedPath}`.replace(
    /__AWJC_TOKEN_(\d+)__/g,
    (_, idxStr: string) => tokenPlaceholders[Number(idxStr)] ?? '',
  );

  const interpolatedBase = interpolateText(restoredBase, context);

  const enabledQueries = effectiveQueryParams.filter(
    p => p.enabled !== false && p.key.trim().length > 0,
  );

  if (enabledQueries.length === 0) {
    return `${interpolatedBase}${hash}`;
  }

  const queryPairs = enabledQueries.map(p => {
    const resolvedKey = interpolateText(p.key, context);
    const resolvedVal = interpolateText(p.value ?? '', context);
    return `${encodeURIComponent(resolvedKey)}=${encodeURIComponent(resolvedVal)}`;
  });

  return `${interpolatedBase}?${queryPairs.join('&')}${hash}`;
}
