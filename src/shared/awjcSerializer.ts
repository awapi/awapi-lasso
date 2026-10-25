import YAML from 'yaml';
import {
  type AwjcCollection,
  type AuthConfig,
  type CollectionTreeItem,
  type FolderItem,
  type KeyValueEntry,
  type PathParamEntry,
  type RequestItem,
  type VariableEntry,
  validateAwjcCollection,
} from './collectionSchema';

export interface ExtractedSecretRecord {
  collectionId: string;
  /** Scope identifier: e.g. 'collection', `env:<envId>`, `folder:<folderId>`, `request:<reqId>`, or `authProfile:<profileId>` */
  scopeId: string;
  key: string;
  value: string;
}

export interface ParseCollectionResult {
  collection: AwjcCollection;
  format: 'yaml' | 'json';
  /** Any plaintext values discovered on `secret: true` fields during load so `secretStore` can migrate them. */
  extractedSecrets: ExtractedSecretRecord[];
}

function extractSecretsFromVariables(
  vars: VariableEntry[] | undefined,
  collectionId: string,
  scopeId: string,
  out: ExtractedSecretRecord[],
): void {
  if (!Array.isArray(vars)) return;
  for (const v of vars) {
    if (v.secret && typeof v.value === 'string' && v.value.length > 0) {
      out.push({
        collectionId,
        scopeId,
        key: v.key,
        value: v.value,
      });
    }
  }
}

function extractSecretsFromKeyValues(
  entries: KeyValueEntry[] | undefined,
  collectionId: string,
  scopeId: string,
  prefix: string,
  out: ExtractedSecretRecord[],
): void {
  if (!Array.isArray(entries)) return;
  for (const entry of entries) {
    if (entry.secret && typeof entry.value === 'string' && entry.value.length > 0) {
      out.push({
        collectionId,
        scopeId,
        key: `${prefix}:${entry.key}`,
        value: entry.value,
      });
    }
  }
}

function extractSecretsFromAuth(
  auth: AuthConfig | undefined,
  collectionId: string,
  scopeId: string,
  out: ExtractedSecretRecord[],
): void {
  if (!auth) return;
  if (auth.bearer?.secret && auth.bearer.token) {
    out.push({ collectionId, scopeId, key: 'auth.bearer.token', value: auth.bearer.token });
  }
  if (auth.basic?.secret && auth.basic.password) {
    out.push({ collectionId, scopeId, key: 'auth.basic.password', value: auth.basic.password });
  }
  if (auth.apikey?.secret && auth.apikey.value) {
    out.push({ collectionId, scopeId, key: 'auth.apikey.value', value: auth.apikey.value });
  }
  if (auth.digest?.secret && auth.digest.password) {
    out.push({ collectionId, scopeId, key: 'auth.digest.password', value: auth.digest.password });
  }
  if (auth.awsv4?.secret && auth.awsv4.secretAccessKey) {
    out.push({
      collectionId,
      scopeId,
      key: 'auth.awsv4.secretAccessKey',
      value: auth.awsv4.secretAccessKey,
    });
  }
  if (auth.oauth2) {
    if (auth.oauth2.clientSecretIsSecret && auth.oauth2.clientSecret) {
      out.push({
        collectionId,
        scopeId,
        key: 'auth.oauth2.clientSecret',
        value: auth.oauth2.clientSecret,
      });
    }
    if (auth.oauth2.passwordIsSecret && auth.oauth2.password) {
      out.push({
        collectionId,
        scopeId,
        key: 'auth.oauth2.password',
        value: auth.oauth2.password,
      });
    }
    extractSecretsFromKeyValues(
      auth.oauth2.extraParams,
      collectionId,
      scopeId,
      'auth.oauth2.extraParams',
      out,
    );
  }
}

function extractSecretsFromTree(
  items: CollectionTreeItem[],
  collectionId: string,
  out: ExtractedSecretRecord[],
): void {
  for (const item of items) {
    if (item.kind === 'folder') {
      const scopeId = `folder:${item.id}`;
      extractSecretsFromVariables(item.variables, collectionId, scopeId, out);
      extractSecretsFromKeyValues(item.headers, collectionId, scopeId, 'header', out);
      extractSecretsFromAuth(item.auth, collectionId, scopeId, out);
      extractSecretsFromTree(item.items, collectionId, out);
    } else if (item.kind === 'request') {
      const scopeId = `request:${item.id}`;
      extractSecretsFromKeyValues(item.headers, collectionId, scopeId, 'header', out);
      extractSecretsFromKeyValues(item.queryParams, collectionId, scopeId, 'query', out);
      extractSecretsFromAuth(item.auth, collectionId, scopeId, out);
    }
  }
}

/**
 * Extracts any plaintext values from `secret: true` fields across the collection.
 */
export function extractPlaintextSecrets(collection: AwjcCollection): ExtractedSecretRecord[] {
  const out: ExtractedSecretRecord[] = [];
  const collectionId = collection.metadata.id;

  extractSecretsFromVariables(collection.variables, collectionId, 'collection', out);
  extractSecretsFromKeyValues(
    collection.defaults?.headers,
    collectionId,
    'collection',
    'header',
    out,
  );
  extractSecretsFromAuth(collection.defaults?.auth, collectionId, 'collection', out);

  for (const profile of collection.authProfiles ?? []) {
    extractSecretsFromAuth(profile, collectionId, `authProfile:${profile.id}`, out);
  }

  for (const env of collection.environments ?? []) {
    extractSecretsFromVariables(env.variables, collectionId, `env:${env.id}`, out);
  }

  extractSecretsFromTree(collection.items, collectionId, out);
  return out;
}

function stripKeyValueList(entries: KeyValueEntry[] | undefined): KeyValueEntry[] | undefined {
  if (!entries) return undefined;
  return entries.map(entry => {
    const clean: KeyValueEntry = {
      key: entry.key,
      ...(entry.secret ? {} : entry.value !== undefined ? { value: entry.value } : {}),
      ...(entry.secret ? { secret: true } : {}),
      enabled: entry.enabled,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
    };
    return clean;
  });
}

function stripPathParamList(entries: PathParamEntry[] | undefined): PathParamEntry[] | undefined {
  if (!entries) return undefined;
  return entries.map(entry => ({
    key: entry.key,
    ...(entry.secret ? {} : entry.value !== undefined ? { value: entry.value } : {}),
    ...(entry.secret ? { secret: true } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
  }));
}

function stripVariablesList(entries: VariableEntry[] | undefined): VariableEntry[] | undefined {
  if (!entries) return undefined;
  return entries.map(entry => ({
    key: entry.key,
    ...(entry.secret ? {} : entry.value !== undefined ? { value: entry.value } : {}),
    ...(entry.secret ? { secret: true } : {}),
    enabled: entry.enabled,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
  }));
}

function stripAuthSecrets(auth: AuthConfig | undefined): AuthConfig | undefined {
  if (!auth) return undefined;
  const result: AuthConfig = { type: auth.type };
  if (auth.profileId !== undefined) result.profileId = auth.profileId;

  if (auth.bearer) {
    result.bearer = {
      token: auth.bearer.secret ? '' : auth.bearer.token,
      ...(auth.bearer.prefix !== undefined ? { prefix: auth.bearer.prefix } : {}),
      ...(auth.bearer.secret ? { secret: true } : {}),
    };
  }
  if (auth.basic) {
    result.basic = {
      username: auth.basic.username,
      ...(auth.basic.secret
        ? { secret: true }
        : auth.basic.password !== undefined
          ? { password: auth.basic.password }
          : {}),
    };
  }
  if (auth.apikey) {
    result.apikey = {
      key: auth.apikey.key,
      ...(auth.apikey.secret
        ? { secret: true }
        : auth.apikey.value !== undefined
          ? { value: auth.apikey.value }
          : {}),
      in: auth.apikey.in,
    };
  }
  if (auth.digest) {
    result.digest = {
      username: auth.digest.username,
      ...(auth.digest.secret
        ? { secret: true }
        : auth.digest.password !== undefined
          ? { password: auth.digest.password }
          : {}),
      ...(auth.digest.realm !== undefined ? { realm: auth.digest.realm } : {}),
    };
  }
  if (auth.awsv4) {
    result.awsv4 = {
      accessKeyId: auth.awsv4.accessKeyId,
      ...(auth.awsv4.secret
        ? { secret: true }
        : auth.awsv4.secretAccessKey !== undefined
          ? { secretAccessKey: auth.awsv4.secretAccessKey }
          : {}),
      ...(auth.awsv4.sessionToken !== undefined ? { sessionToken: auth.awsv4.sessionToken } : {}),
      region: auth.awsv4.region,
      service: auth.awsv4.service,
    };
  }
  if (auth.oauth2) {
    const o = auth.oauth2;
    result.oauth2 = {
      grantType: o.grantType,
      accessTokenUrl: o.accessTokenUrl,
      ...(o.authorizationUrl !== undefined ? { authorizationUrl: o.authorizationUrl } : {}),
      ...(o.redirectUri !== undefined ? { redirectUri: o.redirectUri } : {}),
      clientId: o.clientId,
      ...(o.clientSecretIsSecret
        ? { clientSecretIsSecret: true }
        : o.clientSecret !== undefined
          ? { clientSecret: o.clientSecret }
          : {}),
      ...(o.username !== undefined ? { username: o.username } : {}),
      ...(o.passwordIsSecret
        ? { passwordIsSecret: true }
        : o.password !== undefined
          ? { password: o.password }
          : {}),
      ...(o.scope !== undefined ? { scope: o.scope } : {}),
      ...(o.clientAuthMethod !== undefined ? { clientAuthMethod: o.clientAuthMethod } : {}),
      ...(o.tokenHeaderPrefix !== undefined ? { tokenHeaderPrefix: o.tokenHeaderPrefix } : {}),
      ...(o.pkceCodeChallengeMethod !== undefined
        ? { pkceCodeChallengeMethod: o.pkceCodeChallengeMethod }
        : {}),
      ...(o.autoRefresh !== undefined ? { autoRefresh: o.autoRefresh } : {}),
      ...(o.extraParams ? { extraParams: stripKeyValueList(o.extraParams) } : {}),
    };
  }

  return result;
}

function sanitizeRequestItem(item: RequestItem): RequestItem {
  const clean: RequestItem = {
    kind: 'request',
    id: item.id,
    name: item.name,
    ...(item.description !== undefined ? { description: item.description } : {}),
    protocol: item.protocol,
    method: item.method,
    url: item.url,
    ...(item.queryParams !== undefined
      ? { queryParams: stripKeyValueList(item.queryParams) }
      : {}),
    ...(item.pathParams !== undefined ? { pathParams: stripPathParamList(item.pathParams) } : {}),
    ...(item.headers !== undefined ? { headers: stripKeyValueList(item.headers) } : {}),
    ...(item.auth !== undefined ? { auth: stripAuthSecrets(item.auth) } : {}),
    ...(item.body !== undefined
      ? {
          body: {
            mode: item.body.mode,
            ...(item.body.content !== undefined ? { content: item.body.content } : {}),
            ...(item.body.urlEncoded !== undefined
              ? { urlEncoded: stripKeyValueList(item.body.urlEncoded) }
              : {}),
            ...(item.body.formData !== undefined
              ? {
                  formData: item.body.formData.map(fd => ({
                    key: fd.key,
                    type: fd.type,
                    ...(fd.secret ? {} : fd.value !== undefined ? { value: fd.value } : {}),
                    ...(fd.secret ? { secret: true } : {}),
                    ...(fd.filePath !== undefined ? { filePath: fd.filePath } : {}),
                    ...(fd.contentType !== undefined ? { contentType: fd.contentType } : {}),
                    enabled: fd.enabled,
                    ...(fd.description !== undefined ? { description: fd.description } : {}),
                  })),
                }
              : {}),
            ...(item.body.binaryFilePath !== undefined
              ? { binaryFilePath: item.body.binaryFilePath }
              : {}),
            ...(item.body.contentType !== undefined ? { contentType: item.body.contentType } : {}),
          },
        }
      : {}),
    ...(item.graphql !== undefined
      ? {
          graphql: {
            ...(item.graphql.operationName !== undefined
              ? { operationName: item.graphql.operationName }
              : {}),
            ...(item.graphql.schemaSource !== undefined
              ? { schemaSource: { ...item.graphql.schemaSource } }
              : {}),
            query: item.graphql.query,
            ...(item.graphql.variables !== undefined ? { variables: item.graphql.variables } : {}),
          },
        }
      : {}),
    ...(item.captures !== undefined ? { captures: item.captures.map(c => ({ ...c })) } : {}),
    ...(item.assertions !== undefined ? { assertions: item.assertions.map(a => ({ ...a })) } : {}),
  };
  return clean;
}

function sanitizeFolderItem(item: FolderItem): FolderItem {
  return {
    kind: 'folder',
    id: item.id,
    name: item.name,
    ...(item.description !== undefined ? { description: item.description } : {}),
    ...(item.auth !== undefined ? { auth: stripAuthSecrets(item.auth) } : {}),
    ...(item.headers !== undefined ? { headers: stripKeyValueList(item.headers) } : {}),
    ...(item.variables !== undefined ? { variables: stripVariablesList(item.variables) } : {}),
    items: item.items.map(child =>
      child.kind === 'folder' ? sanitizeFolderItem(child) : sanitizeRequestItem(child),
    ),
  };
}

/**
 * Produces a deterministic, deep-cloned copy of `collection` with all `secret: true`
 * plaintext values stripped so the object is safe to write to disk or commit to Git.
 */
export function prepareCollectionForSave(collection: AwjcCollection): AwjcCollection {
  const sanitized: AwjcCollection = {
    awapiLasso: collection.awapiLasso,
    kind: 'Collection',
    metadata: {
      id: collection.metadata.id,
      name: collection.metadata.name,
      ...(collection.metadata.description !== undefined
        ? { description: collection.metadata.description }
        : {}),
      ...(collection.metadata.version !== undefined
        ? { version: collection.metadata.version }
        : {}),
      ...(collection.metadata.createdAt !== undefined
        ? { createdAt: collection.metadata.createdAt }
        : {}),
      ...(collection.metadata.updatedAt !== undefined
        ? { updatedAt: collection.metadata.updatedAt }
        : {}),
    },
    ...(collection.defaults !== undefined
      ? {
          defaults: {
            ...(collection.defaults.baseUrl !== undefined
              ? { baseUrl: collection.defaults.baseUrl }
              : {}),
            ...(collection.defaults.timeoutMs !== undefined
              ? { timeoutMs: collection.defaults.timeoutMs }
              : {}),
            ...(collection.defaults.followRedirects !== undefined
              ? { followRedirects: collection.defaults.followRedirects }
              : {}),
            ...(collection.defaults.verifySsl !== undefined
              ? { verifySsl: collection.defaults.verifySsl }
              : {}),
            ...(collection.defaults.headers !== undefined
              ? { headers: stripKeyValueList(collection.defaults.headers) }
              : {}),
            ...(collection.defaults.auth !== undefined
              ? { auth: stripAuthSecrets(collection.defaults.auth) }
              : {}),
          },
        }
      : {}),
    ...(collection.authProfiles !== undefined
      ? {
          authProfiles: collection.authProfiles.map(profile => {
            const strippedAuth = stripAuthSecrets(profile)!;
            return {
              id: profile.id,
              name: profile.name,
              ...(profile.description !== undefined ? { description: profile.description } : {}),
              ...strippedAuth,
            };
          }),
        }
      : {}),
    ...(collection.variables !== undefined
      ? { variables: stripVariablesList(collection.variables) }
      : {}),
    ...(collection.activeEnvironment !== undefined
      ? { activeEnvironment: collection.activeEnvironment }
      : {}),
    ...(collection.environments !== undefined
      ? {
          environments: collection.environments.map(env => ({
            id: env.id,
            name: env.name,
            ...(env.color !== undefined ? { color: env.color } : {}),
            variables: stripVariablesList(env.variables) ?? [],
          })),
        }
      : {}),
    items: collection.items.map(item =>
      item.kind === 'folder' ? sanitizeFolderItem(item) : sanitizeRequestItem(item),
    ),
  };

  return sanitized;
}

/**
 * Parses a `.awjc` or `.awj` collection string (YAML 1.2 or JSON) into a validated
 * `AwjcCollection` and extracts any plaintext secrets found on `secret: true` entries.
 */
export function parseCollectionFile(rawContent: string): ParseCollectionResult {
  const trimmed = rawContent.trim();
  if (!trimmed) {
    throw new Error('Collection file is empty');
  }

  const format: 'yaml' | 'json' = trimmed.startsWith('{') ? 'json' : 'yaml';
  let parsed: unknown;
  try {
    parsed = YAML.parse(rawContent);
  } catch (err) {
    throw new Error(
      `Failed to parse collection file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const validation = validateAwjcCollection(parsed);
  if (!validation.valid) {
    throw new Error(`Invalid .awjc collection schema: ${validation.errors.join('; ')}`);
  }

  const collection = parsed as AwjcCollection;
  const extractedSecrets = extractPlaintextSecrets(collection);

  return {
    collection,
    format,
    extractedSecrets,
  };
}

/**
 * Serializes an `AwjcCollection` to clean, 2-space indented YAML with all
 * `secret: true` plaintext values stripped.
 */
export function serializeCollectionToYaml(collection: AwjcCollection): string {
  const sanitized = prepareCollectionForSave(collection);
  return YAML.stringify(sanitized, {
    indent: 2,
    lineWidth: 0,
  });
}

/**
 * Serializes an `AwjcCollection` to formatted 2-space JSON with all
 * `secret: true` plaintext values stripped.
 */
export function serializeCollectionToJson(collection: AwjcCollection): string {
  const sanitized = prepareCollectionForSave(collection);
  return `${JSON.stringify(sanitized, null, 2)}\n`;
}
