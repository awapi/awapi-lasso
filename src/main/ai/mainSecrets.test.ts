import { afterEach, describe, expect, it } from 'vitest';
import { cacheOAuth2Token, clearAllMemoryOAuth2Tokens } from '../oauth2Engine';
import { setSecret, type SecretStoreDeps } from '../secretStore';
import { collectMainSecretValues } from './mainSecrets';

function memoryDeps(): SecretStoreDeps {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/userdata']);
  return {
    userDataDir: '/userdata',
    isEncryptionAvailable: () => true,
    encryptString: p => Buffer.from(`cipher:${p}`, 'utf-8'),
    decryptString: b => b.toString('utf-8').slice('cipher:'.length),
    exists: p => files.has(p) || dirs.has(p),
    readFile: p => {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFile: (p, c) => void files.set(p, c),
    mkdir: p => void dirs.add(p),
  };
}

afterEach(() => clearAllMemoryOAuth2Tokens());

describe('collectMainSecretValues', () => {
  it('includes vault values, token fields of stored OAuth records, and in-memory tokens', () => {
    const deps = memoryDeps();
    setSecret({ collectionId: 'c', scopeId: 'env:e', key: 'apiToken' }, 'vault-secret-1', deps);
    setSecret(
      { collectionId: 'c', scopeId: 'oauth2:default', key: 'token:p' },
      JSON.stringify({ accessToken: 'stored-access', refreshToken: 'stored-refresh', tokenType: 'Bearer' }),
      deps,
    );
    cacheOAuth2Token(
      { collectionId: 'c', profileOrRequestId: 'm' },
      { accessToken: 'memory-access', tokenType: 'Bearer', acquiredAt: 'now', rawResponse: {} },
    );
    const values = collectMainSecretValues(deps);
    expect(values).toEqual(
      expect.arrayContaining(['vault-secret-1', 'stored-access', 'stored-refresh', 'memory-access']),
    );
  });

  it('never throws when the vault cannot be read', () => {
    const deps = { ...memoryDeps(), exists: () => { throw new Error('disk gone'); } };
    cacheOAuth2Token(
      { collectionId: 'c', profileOrRequestId: 'm' },
      { accessToken: 'memory-access', tokenType: 'Bearer', acquiredAt: 'now', rawResponse: {} },
    );
    expect(collectMainSecretValues(deps)).toEqual(['memory-access']);
  });
});
