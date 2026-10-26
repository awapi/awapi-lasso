import { describe, it, expect, vi } from 'vitest';
import { createEmptyCollection } from '../shared/collectionSchema';
import {
  openCollectionFromFile,
  saveCollectionToFile,
  CollectionWatcherRegistry,
  type CollectionFileServiceDeps,
} from './collectionFileService';
import type { SecretStoreDeps } from './secretStore';

function createMockServiceDeps() {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/userdata']);
  const recentFiles: string[] = [];

  const secretDeps: SecretStoreDeps = {
    userDataDir: '/userdata',
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc-bytes:${plain}`, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc-bytes:/, ''),
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

  const deps: CollectionFileServiceDeps = {
    secretDeps,
    readFile: secretDeps.readFile,
    writeFile: secretDeps.writeFile,
    exists: secretDeps.exists,
    onRecentFileAdded: fp => recentFiles.push(fp),
  };

  return { deps, files, recentFiles };
}

describe('collectionFileService', () => {
  it('saves a collection with secrets stripped on disk and hydrates those secrets back from OS Keychain on open', () => {
    const { deps, files, recentFiles } = createMockServiceDeps();

    const col = createEmptyCollection('Orders API', {
      metadata: { id: 'col_orders_01', name: 'Orders API' },
      environments: [
        {
          id: 'env_local',
          name: 'local',
          variables: [
            { key: 'baseUrl', value: 'http://localhost:8080', enabled: true },
            {
              key: 'clientSecret',
              value: 'MY_SUPER_SECRET_CLIENT_KEY',
              secret: true,
              enabled: true,
            },
          ],
        },
      ],
    });

    const saveRes = saveCollectionToFile(
      { filePath: '/workspace/orders.awjc', collection: col },
      deps,
    );

    // Disk YAML must NEVER contain the plaintext secret
    const onDiskYaml = files.get('/workspace/orders.awjc') ?? '';
    expect(onDiskYaml).not.toContain('MY_SUPER_SECRET_CLIENT_KEY');
    expect(onDiskYaml).toContain('secret: true');
    expect(saveRes.serialized).toBe(onDiskYaml);

    // Opening the file back from disk hydrates the secret from OS Keychain
    const opened = openCollectionFromFile('/workspace/orders.awjc', deps);
    const localEnv = opened.collection.environments?.[0];
    const hydratedSecretVar = localEnv?.variables.find(v => v.key === 'clientSecret');
    expect(hydratedSecretVar?.secret).toBe(true);
    expect(hydratedSecretVar?.value).toBe('MY_SUPER_SECRET_CLIENT_KEY');
    expect(recentFiles).toContain('/workspace/orders.awjc');
  });

  it('watches open collection files and suppresses self-save events', () => {
    const registry = new CollectionWatcherRegistry(1000);
    const triggers = new Map<string, (fp: string) => void>();
    const closeFns = new Map<string, ReturnType<typeof vi.fn>>();
    const externalChanges: string[] = [];

    registry.syncWatchedPaths(
      ['/workspace/a.awjc', '/workspace/b.awjc'],
      (fp, cb) => {
        triggers.set(fp, cb);
        const close = vi.fn();
        closeFns.set(fp, close);
        return { close };
      },
      changed => externalChanges.push(changed),
    );

    // Self-save on a.awjc should be suppressed
    registry.markSelfSaved('/workspace/a.awjc');
    expect(registry.isSelfSaveSuppressed('/workspace/a.awjc')).toBe(true);
    triggers.get('/workspace/a.awjc')?.('/workspace/a.awjc');
    expect(externalChanges).toEqual([]);

    // External change on b.awjc fires callback
    triggers.get('/workspace/b.awjc')?.('/workspace/b.awjc');
    expect(externalChanges).toEqual(['/workspace/b.awjc']);

    // Unwatching b.awjc closes its watcher
    registry.syncWatchedPaths(
      ['/workspace/a.awjc'],
      () => ({ close: vi.fn() }),
      changed => externalChanges.push(changed),
    );
    expect(closeFns.get('/workspace/b.awjc')).toHaveBeenCalledTimes(1);

    registry.closeAll();
    expect(closeFns.get('/workspace/a.awjc')).toHaveBeenCalledTimes(1);
  });
});
