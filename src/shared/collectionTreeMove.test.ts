import { describe, it, expect } from 'vitest';
import {
  createDefaultFolder,
  createDefaultHttpRequest,
  type CollectionTreeItem,
} from './collectionSchema';
import {
  canDropTreeItem,
  collectTreeItemIds,
  duplicateTreeItem,
  findTreeItem,
  insertTreeItem,
  moveTreeItem,
  moveTreeItemBetweenCollections,
  removeTreeItem,
  treeItemContains,
} from './collectionTreeMove';

const req = (id: string) => createDefaultHttpRequest({ id, name: id });

function buildTree(): CollectionTreeItem[] {
  return [
    req('r1'),
    createDefaultFolder('A', [req('a1'), createDefaultFolder('B', [req('b1')], { id: 'fB' })], {
      id: 'fA',
    }),
    req('r2'),
  ];
}

/** Compact shape for assertions: ids, with folders as `id[children]`. */
function shape(items: CollectionTreeItem[]): string {
  return items
    .map(i => (i.kind === 'folder' ? `${i.id}[${shape(i.items)}]` : i.id))
    .join(',');
}

describe('collectionTreeMove helpers', () => {
  it('finds nested items, checks containment, and collects subtree ids', () => {
    const tree = buildTree();
    expect(findTreeItem(tree, 'b1')?.id).toBe('b1');
    expect(findTreeItem(tree, 'missing')).toBeUndefined();
    const fA = findTreeItem(tree, 'fA')!;
    expect(treeItemContains(fA, 'b1')).toBe(true);
    expect(treeItemContains(fA, 'fA')).toBe(true);
    expect(treeItemContains(fA, 'r2')).toBe(false);
    expect(collectTreeItemIds(fA)).toEqual(['fA', 'a1', 'fB', 'b1']);
  });

  it('removes a nested item without touching the original tree', () => {
    const tree = buildTree();
    const { items, removed } = removeTreeItem(tree, 'b1');
    expect(removed?.id).toBe('b1');
    expect(shape(items)).toBe('r1,fA[a1,fB[]],r2');
    expect(shape(tree)).toBe('r1,fA[a1,fB[b1]],r2');
    expect(removeTreeItem(tree, 'missing').removed).toBeUndefined();
  });

  it('inserts before, after, into a folder, and at the root', () => {
    const tree = buildTree();
    const x = req('x');
    expect(shape(insertTreeItem(tree, x, { targetId: 'b1', position: 'before' })!)).toBe(
      'r1,fA[a1,fB[x,b1]],r2',
    );
    expect(shape(insertTreeItem(tree, x, { targetId: 'a1', position: 'after' })!)).toBe(
      'r1,fA[a1,x,fB[b1]],r2',
    );
    expect(shape(insertTreeItem(tree, x, { targetId: 'fA', position: 'inside' })!)).toBe(
      'r1,fA[a1,fB[b1],x],r2',
    );
    expect(shape(insertTreeItem(tree, x, { position: 'inside' })!)).toBe(
      'r1,fA[a1,fB[b1]],r2,x',
    );
  });

  it('rejects inserting into a request, a missing target, or before the root', () => {
    const tree = buildTree();
    const x = req('x');
    expect(insertTreeItem(tree, x, { targetId: 'r1', position: 'inside' })).toBeNull();
    expect(insertTreeItem(tree, x, { targetId: 'missing', position: 'after' })).toBeNull();
    expect(insertTreeItem(tree, x, { position: 'before' })).toBeNull();
  });
});

describe('moveTreeItem (same collection)', () => {
  it('reorders siblings and moves items in and out of folders', () => {
    const tree = buildTree();
    expect(shape(moveTreeItem(tree, 'r2', { targetId: 'r1', position: 'before' })!)).toBe(
      'r2,r1,fA[a1,fB[b1]]',
    );
    expect(shape(moveTreeItem(tree, 'r1', { targetId: 'fB', position: 'inside' })!)).toBe(
      'fA[a1,fB[b1,r1]],r2',
    );
    expect(shape(moveTreeItem(tree, 'b1', { position: 'inside' })!)).toBe(
      'r1,fA[a1,fB[]],r2,b1',
    );
    expect(shape(moveTreeItem(tree, 'fB', { targetId: 'r1', position: 'after' })!)).toBe(
      'r1,fB[b1],fA[a1],r2',
    );
  });

  it('refuses to drop a folder into itself or its own subtree', () => {
    const tree = buildTree();
    expect(moveTreeItem(tree, 'fA', { targetId: 'fA', position: 'inside' })).toBeNull();
    expect(moveTreeItem(tree, 'fA', { targetId: 'fB', position: 'inside' })).toBeNull();
    expect(moveTreeItem(tree, 'fA', { targetId: 'b1', position: 'before' })).toBeNull();
    expect(canDropTreeItem(tree, tree, 'fA', { targetId: 'b1', position: 'after' })).toBe(false);
    expect(canDropTreeItem(tree, tree, 'fB', { targetId: 'a1', position: 'after' })).toBe(true);
  });

  it('returns null for unknown items and drops on the item itself', () => {
    const tree = buildTree();
    expect(moveTreeItem(tree, 'missing', { position: 'inside' })).toBeNull();
    expect(moveTreeItem(tree, 'r1', { targetId: 'r1', position: 'after' })).toBeNull();
  });
});

describe('duplicateTreeItem', () => {
  const ids = () => {
    let n = 0;
    return (prefix: string) => `${prefix}_new${++n}`;
  };

  it('inserts the copy right after the original, in the same folder', () => {
    const tree = buildTree();
    expect(shape(duplicateTreeItem(tree, 'b1', ids())!.items)).toBe(
      'r1,fA[a1,fB[b1,req_new1]],r2',
    );
    expect(shape(duplicateTreeItem(tree, 'a1', ids())!.items)).toBe(
      'r1,fA[a1,req_new1,fB[b1]],r2',
    );
    expect(shape(duplicateTreeItem(tree, 'r1', ids())!.items)).toBe(
      'r1,req_new1,fA[a1,fB[b1]],r2',
    );
    expect(shape(tree)).toBe('r1,fA[a1,fB[b1]],r2');
  });

  it('names the copy and gives every item in a copied folder a fresh id', () => {
    const tree = buildTree();
    const result = duplicateTreeItem(tree, 'fB', ids())!;
    expect(result.copy.name).toBe('B (Copy)');
    expect(shape(result.items)).toBe('r1,fA[a1,fB[b1],fld_new1[req_new2]],r2');
    const b1Copy = findTreeItem(result.items, 'req_new2')!;
    expect(b1Copy.name).toBe('b1');
  });

  it('returns null for an unknown item', () => {
    expect(duplicateTreeItem(buildTree(), 'missing')).toBeNull();
  });
});

describe('moveTreeItemBetweenCollections', () => {
  it('moves a folder with its children to another collection, keeping free ids', () => {
    const source = buildTree();
    const target: CollectionTreeItem[] = [req('t1'), createDefaultFolder('T', [], { id: 'fT' })];
    const result = moveTreeItemBetweenCollections(source, target, 'fA', {
      targetId: 'fT',
      position: 'inside',
    })!;
    expect(shape(result.sourceItems)).toBe('r1,r2');
    expect(shape(result.targetItems)).toBe('t1,fT[fA[a1,fB[b1]]]');
    expect([...result.idMap.entries()]).toEqual([
      ['fA', 'fA'],
      ['a1', 'a1'],
      ['fB', 'fB'],
      ['b1', 'b1'],
    ]);
  });

  it('gives moved items fresh ids when they collide with ids in the target', () => {
    const source = buildTree();
    const target: CollectionTreeItem[] = [req('a1'), req('fA')];
    let n = 0;
    const result = moveTreeItemBetweenCollections(
      source,
      target,
      'fA',
      { targetId: 'a1', position: 'before' },
      prefix => `${prefix}_new${++n}`,
    )!;
    expect(shape(result.targetItems)).toBe('fld_new1[req_new2,fB[b1]],a1,fA');
    expect(result.idMap.get('fA')).toBe('fld_new1');
    expect(result.idMap.get('a1')).toBe('req_new2');
    expect(result.idMap.get('b1')).toBe('b1');
  });

  it('appends to the target root and rejects invalid targets', () => {
    const source = buildTree();
    const target: CollectionTreeItem[] = [req('t1')];
    const result = moveTreeItemBetweenCollections(source, target, 'r1', { position: 'inside' })!;
    expect(shape(result.sourceItems)).toBe('fA[a1,fB[b1]],r2');
    expect(shape(result.targetItems)).toBe('t1,r1');

    expect(
      moveTreeItemBetweenCollections(source, target, 'r1', { targetId: 't1', position: 'inside' }),
    ).toBeNull();
    expect(
      moveTreeItemBetweenCollections(source, target, 'missing', { position: 'inside' }),
    ).toBeNull();
  });
});
