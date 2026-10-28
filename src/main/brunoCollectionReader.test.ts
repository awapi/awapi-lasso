import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { MAX_BRUNO_FILES, readBrunoCollectionFolder, type BrunoReaderDeps } from './brunoCollectionReader';

/** In-memory file tree keyed by `/`-separated paths relative to `root`. */
function fakeFs(root: string, tree: Record<string, string>): BrunoReaderDeps {
  const rel = (p: string) => path.relative(root, p).split(path.sep).join('/');
  return {
    readFile: p => {
      const content = tree[rel(p)];
      if (content === undefined) throw new Error(`ENOENT ${p}`);
      return content;
    },
    readDir: p => {
      const dir = rel(p);
      const prefix = dir ? `${dir}/` : '';
      const names = new Map<string, boolean>();
      for (const key of Object.keys(tree)) {
        if (!key.startsWith(prefix)) continue;
        const [first, ...more] = key.slice(prefix.length).split('/');
        names.set(first, more.length > 0 || names.get(first) === true);
      }
      return [...names.entries()].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory }));
    },
  };
}

const root = path.resolve('/work/shop-api');

describe('brunoCollectionReader', () => {
  it('reads bruno.json and .bru files recursively with relative / paths, skipping ignored folders', () => {
    const files = readBrunoCollectionFolder(
      root,
      fakeFs(root, {
        'bruno.json': JSON.stringify({ name: 'Shop', ignore: ['node_modules', '.git', 'scratch'] }),
        'collection.bru': 'meta {}',
        'environments/local.bru': 'vars {}',
        'Orders/Get.bru': 'get {}',
        'Orders/notes.md': '# not read',
        'scratch/Old.bru': 'get {}',
        'node_modules/pkg/x.bru': 'get {}',
        '.env': 'SECRET=1',
      }),
    );
    expect(files.map(f => f.path).sort()).toEqual([
      'Orders/Get.bru',
      'bruno.json',
      'collection.bru',
      'environments/local.bru',
    ]);
    expect(files.find(f => f.path === 'Orders/Get.bru')?.content).toBe('get {}');
  });

  it('fails clearly when the folder is not a Bruno collection', () => {
    expect(() => readBrunoCollectionFolder(root, fakeFs(root, { 'a.bru': '' }))).toThrow(
      /bruno.json was not found/,
    );
  });

  it('stops on folders with too many .bru files', () => {
    const tree: Record<string, string> = { 'bruno.json': '{}' };
    for (let i = 0; i <= MAX_BRUNO_FILES + 1; i++) tree[`r${i}.bru`] = '';
    expect(() => readBrunoCollectionFolder(root, fakeFs(root, tree))).toThrow(/more than 5000 \.bru files/);
  });
});
