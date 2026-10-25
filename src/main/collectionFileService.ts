import {
  type AwjcCollection,
  type AuthConfig,
  type CollectionTreeItem,
  type VariableEntry,
} from '../shared/collectionSchema';
import {
  parseCollectionFile,
  serializeCollectionToYaml,
  serializeCollectionToJson,
  extractPlaintextSecrets,
} from '../shared/awjcSerializer';
import {
  setSecret,
  getAllCollectionSecrets,
  type SecretStoreDeps,
} from './secretStore';

export interface OpenedCollectionPayload {
  filePath: string;
  format: 'yaml' | 'json';
  collection: AwjcCollection;
}

export interface SaveCollectionOptions {
  filePath: string;
  collection: AwjcCollection;
  format?: 'yaml' | 'json';
}

export interface CollectionWatcherHandle {
  close: () => void;
}

export interface CollectionFileServiceDeps {
  secretDeps: SecretStoreDeps;
  readFile: (filePath: string) => string;
  writeFile: (filePath: string, content: string) => void;
  exists: (filePath: string) => boolean;
  onRecentFileAdded?: (filePath: string) => void;
  watchFile?: (filePath: string, onChange: () => void) => CollectionWatcherHandle;
}

function hydrateVariablesList(
  vars: VariableEntry[] | undefined,
  scopeSecrets: Record<string, string> | undefined,
): void {
  if (!Array.isArray(vars) || !scopeSecrets) return;
  for (const v of vars) {
    if (v.secret && scopeSecrets[v.key] !== undefined) {
      v.value = scopeSecrets[v.key];
    }
  }
}

function hydrateAuthSecrets(
  auth: AuthConfig | undefined,
  scopeSecrets: Record<string, string> | undefined,
): void {
  if (!auth || !scopeSecrets) return;
  if (auth.bearer?.secret && scopeSecrets['auth.bearer.token'] !== undefined) {
    auth.bearer.token = scopeSecrets['auth.bearer.token'];
  }
  if (auth.basic?.secret && scopeSecrets['auth.basic.password'] !== undefined) {
    auth.basic.password = scopeSecrets['auth.basic.password'];
  }
  if (auth.apikey?.secret && scopeSecrets['auth.apikey.value'] !== undefined) {
    auth.apikey.value = scopeSecrets['auth.apikey.value'];
  }
  if (auth.digest?.secret && scopeSecrets['auth.digest.password'] !== undefined) {
    auth.digest.password = scopeSecrets['auth.digest.password'];
  }
  if (auth.awsv4?.secret && scopeSecrets['auth.awsv4.secretAccessKey'] !== undefined) {
    auth.awsv4.secretAccessKey = scopeSecrets['auth.awsv4.secretAccessKey'];
  }
  if (auth.oauth2) {
    if (
      auth.oauth2.clientSecretIsSecret &&
      scopeSecrets['auth.oauth2.clientSecret'] !== undefined
    ) {
      auth.oauth2.clientSecret = scopeSecrets['auth.oauth2.clientSecret'];
    }
    if (auth.oauth2.passwordIsSecret && scopeSecrets['auth.oauth2.password'] !== undefined) {
      auth.oauth2.password = scopeSecrets['auth.oauth2.password'];
    }
  }
}

function hydrateTreeItems(
  items: CollectionTreeItem[],
  byScope: Record<string, Record<string, string>>,
): void {
  for (const item of items) {
    if (item.kind === 'folder') {
      const scope = byScope[`folder:${item.id}`];
      hydrateVariablesList(item.variables, scope);
      hydrateAuthSecrets(item.auth, scope);
      hydrateTreeItems(item.items, byScope);
    } else if (item.kind === 'request') {
      const scope = byScope[`request:${item.id}`];
      hydrateAuthSecrets(item.auth, scope);
    }
  }
}

/**
 * Hydrates in-memory `secret: true` fields on `collection` from `secretStore` (OS Keychain + optional sidecar).
 */
export function hydrateCollectionSecrets(
  collection: AwjcCollection,
  filePath: string | undefined,
  secretDeps: SecretStoreDeps,
): AwjcCollection {
  const { byScope } = getAllCollectionSecrets(collection.metadata.id, secretDeps, {
    collectionFilePath: filePath,
  });

  hydrateVariablesList(collection.variables, byScope.collection);
  hydrateAuthSecrets(collection.defaults?.auth, byScope.collection);

  for (const profile of collection.authProfiles ?? []) {
    hydrateAuthSecrets(profile, byScope[`authProfile:${profile.id}`]);
  }

  for (const env of collection.environments ?? []) {
    hydrateVariablesList(env.variables, byScope[`env:${env.id}`]);
  }

  hydrateTreeItems(collection.items, byScope);
  return collection;
}

/**
 * Reads a `.awjc` / `.awj` collection file from disk, migrates any plaintext secrets on
 * `secret: true` fields into `secretStore`, hydrates secrets from OS Keychain / sidecar,
 * and records the path in `Open Recent`.
 */
export function openCollectionFromFile(
  filePath: string,
  deps: CollectionFileServiceDeps,
): OpenedCollectionPayload {
  const raw = deps.readFile(filePath);
  const parsed = parseCollectionFile(raw);

  // Migrate any plaintext secrets found in the file into OS Keychain
  for (const rec of parsed.extractedSecrets) {
    setSecret(
      { collectionId: rec.collectionId, scopeId: rec.scopeId, key: rec.key },
      rec.value,
      deps.secretDeps,
    );
  }

  hydrateCollectionSecrets(parsed.collection, filePath, deps.secretDeps);
  deps.onRecentFileAdded?.(filePath);

  return {
    filePath,
    format: parsed.format,
    collection: parsed.collection,
  };
}

/**
 * Persists any `secret: true` values from `collection` into `secretStore`, strips all
 * plaintext secret values from the serialized output, and writes the `.awjc` / `.awj` file.
 */
export function saveCollectionToFile(
  options: SaveCollectionOptions,
  deps: CollectionFileServiceDeps,
): { filePath: string; serialized: string } {
  const { filePath, collection, format = 'yaml' } = options;

  // Persist any in-memory secret values into OS Keychain before stripping them from the file
  const secretsToPersist = extractPlaintextSecrets(collection);
  for (const rec of secretsToPersist) {
    setSecret(
      { collectionId: rec.collectionId, scopeId: rec.scopeId, key: rec.key },
      rec.value,
      deps.secretDeps,
    );
  }

  const updatedCollection: AwjcCollection = {
    ...collection,
    metadata: {
      ...collection.metadata,
      updatedAt: new Date().toISOString(),
    },
  };

  const serialized =
    format === 'json'
      ? serializeCollectionToJson(updatedCollection)
      : serializeCollectionToYaml(updatedCollection);

  deps.writeFile(filePath, serialized);
  deps.onRecentFileAdded?.(filePath);

  return { filePath, serialized };
}

/**
 * Coordinates watching open `.awjc` / `.awj` files on disk while suppressing self-saves.
 */
export class CollectionWatcherRegistry {
  private readonly watchers = new Map<string, CollectionWatcherHandle>();
  private readonly selfSavedTimestamps = new Map<string, number>();
  private readonly suppressWindowMs: number;

  constructor(suppressWindowMs = 750) {
    this.suppressWindowMs = suppressWindowMs;
  }

  markSelfSaved(filePath: string, now = Date.now()): void {
    this.selfSavedTimestamps.set(filePath, now);
  }

  isSelfSaveSuppressed(filePath: string, now = Date.now()): boolean {
    const ts = this.selfSavedTimestamps.get(filePath);
    if (ts === undefined) return false;
    if (now - ts <= this.suppressWindowMs) {
      return true;
    }
    this.selfSavedTimestamps.delete(filePath);
    return false;
  }

  syncWatchedPaths(
    filePaths: string[],
    watchFactory: (filePath: string, onExternalChange: (fp: string) => void) => CollectionWatcherHandle,
    onExternalChange: (filePath: string) => void,
  ): void {
    const desired = new Set(filePaths);

    for (const [existingPath, handle] of this.watchers.entries()) {
      if (!desired.has(existingPath)) {
        handle.close();
        this.watchers.delete(existingPath);
      }
    }

    for (const fp of desired) {
      if (!this.watchers.has(fp)) {
        const handle = watchFactory(fp, changedPath => {
          if (!this.isSelfSaveSuppressed(changedPath)) {
            onExternalChange(changedPath);
          }
        });
        this.watchers.set(fp, handle);
      }
    }
  }

  closeAll(): void {
    for (const handle of this.watchers.values()) {
      handle.close();
    }
    this.watchers.clear();
  }
}
