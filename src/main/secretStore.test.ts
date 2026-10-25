import { describe, it, expect } from 'vitest';
import {
  getSidecarFilePath,
  setSecret,
  getSecret,
  deleteSecret,
  getAllCollectionSecrets,
  saveSidecarSecrets,
  ensureSecretsInGitignore,
  type SecretStoreDeps,
} from './secretStore';

function createMemorySecretDeps(encryptionAvailable = true): {
  deps: SecretStoreDeps;
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/userdata']);

  const deps: SecretStoreDeps = {
    userDataDir: '/userdata',
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (plain: string) => Buffer.from(`cipher:${plain}`, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const str = buf.toString('utf-8');
      if (!str.startsWith('cipher:')) throw new Error('Invalid ciphertext');
      return str.slice('cipher:'.length);
    },
    exists: p => files.has(p) || dirs.has(p),
    readFile: p => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    writeFile: (p, content) => {
      files.set(p, content);
    },
    mkdir: p => {
      dirs.add(p);
    },
  };

  return { deps, files };
}

describe('secretStore', () => {
  it('computes <collection>.secrets.awjc sidecar paths for .awjc and .awj files', () => {
    expect(getSidecarFilePath('/work/orders.awjc')).toBe('/work/orders.secrets.awjc');
    expect(getSidecarFilePath('/work/orders.awj')).toBe('/work/orders.secrets.awjc');
  });

  it('encrypts secrets with safeStorage and never stores plaintext in secrets-vault.json', () => {
    const { deps, files } = createMemorySecretDeps(true);
    const coord = {
      collectionId: 'col_orders_01',
      scopeId: 'env:env_local',
      key: 'clientSecret',
    };

    setSecret(coord, 'TOP_SECRET_OAUTH_VALUE_999', deps);

    const rawVault = files.get('/userdata/secrets-vault.json') ?? '';
    expect(rawVault).toContain('enc:');
    expect(rawVault).not.toContain('TOP_SECRET_OAUTH_VALUE_999');

    expect(getSecret(coord, deps)).toBe('TOP_SECRET_OAUTH_VALUE_999');

    expect(deleteSecret(coord, deps)).toBe(true);
    expect(getSecret(coord, deps)).toBeNull();
  });

  it('merges OS Keychain secrets with local <collection>.secrets.awjc sidecar overrides', () => {
    const { deps } = createMemorySecretDeps(true);

    setSecret(
      { collectionId: 'col_1', scopeId: 'env:env_local', key: 'clientSecret' },
      'keychain-secret',
      deps,
    );
    setSecret(
      { collectionId: 'col_1', scopeId: 'env:env_local', key: 'apiPassword' },
      'keychain-password',
      deps,
    );

    saveSidecarSecrets(
      '/repo/orders.awjc',
      'col_1',
      {
        'env:env_local': {
          clientSecret: 'sidecar-override-secret',
        },
      },
      deps,
    );

    // Sidecar overrides clientSecret while apiPassword still comes from OS Keychain
    expect(
      getSecret(
        { collectionId: 'col_1', scopeId: 'env:env_local', key: 'clientSecret' },
        deps,
        { collectionFilePath: '/repo/orders.awjc' },
      ),
    ).toBe('sidecar-override-secret');

    const all = getAllCollectionSecrets('col_1', deps, {
      collectionFilePath: '/repo/orders.awjc',
    });
    expect(all.byScope['env:env_local']).toEqual({
      clientSecret: 'sidecar-override-secret',
      apiPassword: 'keychain-password',
    });
  });

  it('adds *.secrets.awjc patterns to .gitignore idempotently', () => {
    const { deps, files } = createMemorySecretDeps(true);
    files.set('/repo/.gitignore', 'node_modules/\ndist/\n');

    const first = ensureSecretsInGitignore('/repo/.gitignore', deps);
    expect(first.updated).toBe(true);
    expect(first.addedPatterns).toContain('*.secrets.awjc');
    expect(files.get('/repo/.gitignore')).toContain('*.secrets.awjc');

    const second = ensureSecretsInGitignore('/repo/.gitignore', deps);
    expect(second.updated).toBe(false);
    expect(second.addedPatterns).toEqual([]);
  });
});
