import YAML from 'yaml';

export const SECRETS_VAULT_FILENAME = 'secrets-vault.json';
export const SECRETS_GITIGNORE_PATTERNS = ['*.secrets.awjc', '*.secrets.awj', '.env.secret*'] as const;

export interface SecretCoordinate {
  collectionId: string;
  /** Scope identifier: e.g. 'collection', `env:<envId>`, `folder:<folderId>`, `request:<reqId>`, or `authProfile:<profileId>` */
  scopeId: string;
  key: string;
}

export interface SecretVaultData {
  version: 1;
  /** Maps composite key `${collectionId}::${scopeId}::${key}` to `enc:` base64 ciphertext produced by `safeStorage`. Legacy `b64:` entries are re-encrypted on load. */
  entries: Record<string, string>;
}

export interface LocalSecretsSidecarDoc {
  awapiLassoSecrets: '1.0';
  collectionId?: string;
  /** Nested map: `secrets[scopeId][key] = plaintextValue` */
  secrets: Record<string, Record<string, string>>;
}

export interface SecretStoreDeps {
  /** Directory where `secrets-vault.json` is stored (`app.getPath('userData')`). */
  userDataDir: string;
  /** Whether Electron `safeStorage.isEncryptionAvailable()` is true. */
  isEncryptionAvailable: () => boolean;
  /** Encrypts plaintext via Electron `safeStorage.encryptString(text)`. */
  encryptString: (plaintext: string) => Buffer;
  /** Decrypts a Buffer via Electron `safeStorage.decryptString(encrypted)`. */
  decryptString: (cipherBuffer: Buffer) => string;
  exists: (filePath: string) => boolean;
  readFile: (filePath: string) => string;
  writeFile: (filePath: string, content: string) => void;
  mkdir: (dirPath: string) => void;
}

/** Thrown when the OS keychain-backed encryption is unavailable, so secrets are never stored unencrypted. */
export class SecretEncryptionUnavailableError extends Error {
  constructor() {
    super(
      'Secure storage is unavailable on this system (OS keychain / Secret Service not accessible). ' +
        'Secrets cannot be saved unencrypted; use a local <collection>.secrets.awjc sidecar instead.',
    );
    this.name = 'SecretEncryptionUnavailableError';
  }
}

export function buildVaultEntryKey(coord: SecretCoordinate): string {
  return `${coord.collectionId}::${coord.scopeId}::${coord.key}`;
}

export function parseVaultEntryKey(compositeKey: string): SecretCoordinate | null {
  const parts = compositeKey.split('::');
  if (parts.length < 3) return null;
  const [collectionId, scopeId, ...rest] = parts;
  return {
    collectionId,
    scopeId,
    key: rest.join('::'),
  };
}

/**
 * Computes the gitignored sidecar path (`<collection>.secrets.awjc`) for a `.awjc` / `.awj` file.
 */
export function getSidecarFilePath(collectionFilePath: string): string {
  if (/\.awjc$/i.test(collectionFilePath)) {
    return collectionFilePath.replace(/\.awjc$/i, '.secrets.awjc');
  }
  if (/\.awj$/i.test(collectionFilePath)) {
    return collectionFilePath.replace(/\.awj$/i, '.secrets.awjc');
  }
  return `${collectionFilePath}.secrets.awjc`;
}

function joinSimplePath(dir: string, file: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return `${dir.replace(/[\\/]+$/, '')}${sep}${file}`;
}

function loadVault(deps: SecretStoreDeps): SecretVaultData {
  const vaultPath = joinSimplePath(deps.userDataDir, SECRETS_VAULT_FILENAME);
  try {
    if (deps.exists(vaultPath)) {
      const parsed = JSON.parse(deps.readFile(vaultPath)) as SecretVaultData;
      if (parsed && typeof parsed.entries === 'object' && parsed.entries !== null) {
        const vault: SecretVaultData = { version: 1, entries: { ...parsed.entries } };
        upgradeLegacyEntries(vault, deps);
        return vault;
      }
    }
  } catch {
    // ignore corrupt vault
  }
  return { version: 1, entries: {} };
}

/** Re-encrypts legacy `b64:` (unencrypted) entries with `safeStorage` once encryption is available. */
function upgradeLegacyEntries(vault: SecretVaultData, deps: SecretStoreDeps): void {
  if (!deps.isEncryptionAvailable()) return;
  let changed = false;
  for (const [key, stored] of Object.entries(vault.entries)) {
    if (!stored.startsWith('b64:')) continue;
    const plaintext = decodeSecretValue(stored, deps);
    if (plaintext === null) continue;
    vault.entries[key] = encodeSecretValue(plaintext, deps);
    changed = true;
  }
  if (changed) saveVault(deps, vault);
}

function saveVault(deps: SecretStoreDeps, vault: SecretVaultData): void {
  if (!deps.exists(deps.userDataDir)) {
    deps.mkdir(deps.userDataDir);
  }
  const vaultPath = joinSimplePath(deps.userDataDir, SECRETS_VAULT_FILENAME);
  deps.writeFile(vaultPath, JSON.stringify(vault, null, 2));
}

function encodeSecretValue(plaintext: string, deps: SecretStoreDeps): string {
  if (!deps.isEncryptionAvailable()) {
    throw new SecretEncryptionUnavailableError();
  }
  const encrypted = deps.encryptString(plaintext);
  return `enc:${encrypted.toString('base64')}`;
}

function decodeSecretValue(stored: string, deps: SecretStoreDeps): string | null {
  try {
    if (stored.startsWith('enc:')) {
      const buf = Buffer.from(stored.slice(4), 'base64');
      return deps.decryptString(buf);
    }
    // Legacy format written by older versions when encryption was unavailable (read-only support).
    if (stored.startsWith('b64:')) {
      return Buffer.from(stored.slice(4), 'base64').toString('utf-8');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Stores a secret value in the OS Keychain-backed vault (`safeStorage`).
 * @throws SecretEncryptionUnavailableError when `safeStorage` encryption is unavailable.
 */
export function setSecret(
  coord: SecretCoordinate,
  value: string,
  deps: SecretStoreDeps,
): void {
  const vault = loadVault(deps);
  const compositeKey = buildVaultEntryKey(coord);
  vault.entries[compositeKey] = encodeSecretValue(value, deps);
  saveVault(deps, vault);
}

/**
 * Retrieves a secret value from the OS Keychain-backed vault (or optional local sidecar override).
 */
export function getSecret(
  coord: SecretCoordinate,
  deps: SecretStoreDeps,
  options?: { collectionFilePath?: string },
): string | null {
  if (options?.collectionFilePath) {
    const sidecarSecrets = loadSidecarSecrets(options.collectionFilePath, deps);
    const fromSidecar = sidecarSecrets[coord.scopeId]?.[coord.key];
    if (typeof fromSidecar === 'string') {
      return fromSidecar;
    }
  }

  const vault = loadVault(deps);
  const stored = vault.entries[buildVaultEntryKey(coord)];
  if (!stored) return null;
  return decodeSecretValue(stored, deps);
}

/**
 * Deletes a secret value from the OS Keychain-backed vault.
 */
export function deleteSecret(coord: SecretCoordinate, deps: SecretStoreDeps): boolean {
  const vault = loadVault(deps);
  const compositeKey = buildVaultEntryKey(coord);
  if (!(compositeKey in vault.entries)) {
    return false;
  }
  delete vault.entries[compositeKey];
  saveVault(deps, vault);
  return true;
}

/**
 * Returns all secrets for a given `collectionId`, merging OS Keychain vault entries with
 * any optional `<collection>.secrets.awjc` local sidecar overrides.
 * Returns a nested map: `Record<scopeId, Record<key, value>>` plus a flat `Record<key, value>` helper.
 */
export function getAllCollectionSecrets(
  collectionId: string,
  deps: SecretStoreDeps,
  options?: { collectionFilePath?: string },
): {
  byScope: Record<string, Record<string, string>>;
  flatByKey: Record<string, string>;
} {
  const byScope: Record<string, Record<string, string>> = {};
  const flatByKey: Record<string, string> = {};

  const vault = loadVault(deps);
  for (const [compositeKey, encoded] of Object.entries(vault.entries)) {
    const parsed = parseVaultEntryKey(compositeKey);
    if (!parsed || parsed.collectionId !== collectionId) continue;
    const decoded = decodeSecretValue(encoded, deps);
    if (decoded === null) continue;
    if (!byScope[parsed.scopeId]) byScope[parsed.scopeId] = {};
    byScope[parsed.scopeId][parsed.key] = decoded;
    flatByKey[parsed.key] = decoded;
  }

  if (options?.collectionFilePath) {
    const sidecar = loadSidecarSecrets(options.collectionFilePath, deps);
    for (const [scopeId, kv] of Object.entries(sidecar)) {
      if (!byScope[scopeId]) byScope[scopeId] = {};
      for (const [key, val] of Object.entries(kv)) {
        byScope[scopeId][key] = val;
        flatByKey[key] = val;
      }
    }
  }

  return { byScope, flatByKey };
}

/**
 * Loads secrets from an optional `<collection>.secrets.awjc` sidecar file if present.
 */
export function loadSidecarSecrets(
  collectionFilePath: string,
  deps: Pick<SecretStoreDeps, 'exists' | 'readFile'>,
): Record<string, Record<string, string>> {
  const sidecarPath = getSidecarFilePath(collectionFilePath);
  if (!deps.exists(sidecarPath)) return {};

  try {
    const raw = deps.readFile(sidecarPath);
    const parsed = YAML.parse(raw) as Partial<LocalSecretsSidecarDoc>;
    if (!parsed || typeof parsed.secrets !== 'object' || parsed.secrets === null) {
      return {};
    }
    return parsed.secrets;
  } catch {
    return {};
  }
}

/**
 * Writes or updates a `<collection>.secrets.awjc` local sidecar file.
 */
export function saveSidecarSecrets(
  collectionFilePath: string,
  collectionId: string,
  secrets: Record<string, Record<string, string>>,
  deps: Pick<SecretStoreDeps, 'writeFile'>,
): string {
  const sidecarPath = getSidecarFilePath(collectionFilePath);
  const doc: LocalSecretsSidecarDoc = {
    awapiLassoSecrets: '1.0',
    collectionId,
    secrets,
  };
  deps.writeFile(sidecarPath, YAML.stringify(doc, { indent: 2 }));
  return sidecarPath;
}

/**
 * Ensures `*.secrets.awjc` (and related local secret patterns) are listed in the target `.gitignore` file.
 */
export function ensureSecretsInGitignore(
  gitignorePath: string,
  deps: Pick<SecretStoreDeps, 'exists' | 'readFile' | 'writeFile'>,
): { updated: boolean; addedPatterns: string[] } {
  const existingContent = deps.exists(gitignorePath) ? deps.readFile(gitignorePath) : '';
  const existingLines = new Set(
    existingContent
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean),
  );

  const addedPatterns: string[] = [];
  for (const pattern of SECRETS_GITIGNORE_PATTERNS) {
    if (!existingLines.has(pattern)) {
      addedPatterns.push(pattern);
    }
  }

  if (addedPatterns.length === 0) {
    return { updated: false, addedPatterns: [] };
  }

  const needsLeadingNewline = existingContent.length > 0 && !existingContent.endsWith('\n');
  const block = [
    ...(needsLeadingNewline ? [''] : []),
    '# AwapiLasso local secrets sidecar',
    ...addedPatterns,
    '',
  ].join('\n');

  deps.writeFile(gitignorePath, `${existingContent}${block}`);
  return { updated: true, addedPatterns };
}
