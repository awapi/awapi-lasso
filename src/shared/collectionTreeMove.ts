import { generateAwjcId, type CollectionTreeItem } from './collectionSchema';

export type TreeDropPosition = 'before' | 'after' | 'inside';

/**
 * Where a dragged tree item should land. `before` / `after` place it next to
 * `targetId`; `inside` appends it to the folder `targetId`, or to the
 * collection root when `targetId` is omitted.
 */
export interface TreeDropTarget {
  targetId?: string;
  position: TreeDropPosition;
}

export function findTreeItem(
  items: CollectionTreeItem[],
  itemId: string,
): CollectionTreeItem | undefined {
  for (const item of items) {
    if (item.id === itemId) return item;
    if (item.kind === 'folder') {
      const found = findTreeItem(item.items, itemId);
      if (found) return found;
    }
  }
  return undefined;
}

/** True when `id` is `item` itself or anything nested inside it. */
export function treeItemContains(item: CollectionTreeItem, id: string): boolean {
  if (item.id === id) return true;
  return item.kind === 'folder' && item.items.some(child => treeItemContains(child, id));
}

export function collectTreeItemIds(item: CollectionTreeItem): string[] {
  if (item.kind !== 'folder') return [item.id];
  return [item.id, ...item.items.flatMap(collectTreeItemIds)];
}

/**
 * Checks whether `itemId` (from `sourceItems`) can be dropped on `target` in
 * `targetItems`. Pass the same array for both when moving within a collection.
 */
export function canDropTreeItem(
  sourceItems: CollectionTreeItem[],
  targetItems: CollectionTreeItem[],
  itemId: string,
  target: TreeDropTarget,
): boolean {
  const moving = findTreeItem(sourceItems, itemId);
  if (!moving) return false;
  if (target.targetId === undefined) return target.position === 'inside';

  const targetItem = findTreeItem(targetItems, target.targetId);
  if (!targetItem) return false;
  if (target.position === 'inside' && targetItem.kind !== 'folder') return false;
  // A folder can't be dropped on itself or into its own subtree.
  if (sourceItems === targetItems && treeItemContains(moving, target.targetId)) return false;
  return true;
}

export function removeTreeItem(
  items: CollectionTreeItem[],
  itemId: string,
): { items: CollectionTreeItem[]; removed?: CollectionTreeItem } {
  let removed: CollectionTreeItem | undefined;
  const next: CollectionTreeItem[] = [];
  for (const item of items) {
    if (item.id === itemId) {
      removed = item;
      continue;
    }
    if (!removed && item.kind === 'folder') {
      const inner = removeTreeItem(item.items, itemId);
      if (inner.removed) {
        removed = inner.removed;
        next.push({ ...item, items: inner.items });
        continue;
      }
    }
    next.push(item);
  }
  return removed ? { items: next, removed } : { items };
}

/** Inserts `newItem` at `target`. Returns null when the target doesn't exist or isn't a folder for `inside`. */
export function insertTreeItem(
  items: CollectionTreeItem[],
  newItem: CollectionTreeItem,
  target: TreeDropTarget,
): CollectionTreeItem[] | null {
  if (target.targetId === undefined) {
    return target.position === 'inside' ? [...items, newItem] : null;
  }
  let inserted = false;
  const visit = (list: CollectionTreeItem[]): CollectionTreeItem[] => {
    const next: CollectionTreeItem[] = [];
    for (const item of list) {
      if (!inserted && item.id === target.targetId) {
        inserted = true;
        if (target.position === 'before') {
          next.push(newItem, item);
        } else if (target.position === 'after') {
          next.push(item, newItem);
        } else if (item.kind === 'folder') {
          next.push({ ...item, items: [...item.items, newItem] });
        } else {
          inserted = false;
          next.push(item);
        }
        continue;
      }
      if (!inserted && item.kind === 'folder') {
        const children = visit(item.items);
        next.push(children === item.items ? item : { ...item, items: children });
        continue;
      }
      next.push(item);
    }
    return inserted ? next : list;
  };
  const result = visit(items);
  return inserted ? result : null;
}

/** Moves an item within one collection. Returns null when the move is invalid. */
export function moveTreeItem(
  items: CollectionTreeItem[],
  itemId: string,
  target: TreeDropTarget,
): CollectionTreeItem[] | null {
  if (target.targetId === itemId) return null;
  if (!canDropTreeItem(items, items, itemId, target)) return null;
  const { items: without, removed } = removeTreeItem(items, itemId);
  if (!removed) return null;
  return insertTreeItem(without, removed, target);
}

function reassignIds(
  item: CollectionTreeItem,
  takenIds: Set<string>,
  idMap: Map<string, string>,
  generateId: (prefix: string) => string,
): CollectionTreeItem {
  let id = item.id;
  if (takenIds.has(id)) {
    id = generateId(item.kind === 'folder' ? 'fld' : 'req');
  }
  takenIds.add(id);
  idMap.set(item.id, id);
  if (item.kind === 'folder') {
    return {
      ...item,
      id,
      items: item.items.map(child => reassignIds(child, takenIds, idMap, generateId)),
    };
  }
  return id === item.id ? item : { ...item, id };
}

/**
 * Copies an item (and its subtree, for folders) and inserts the copy right
 * after the original, in the same folder. Every copied item gets a fresh id.
 * Returns null when the item doesn't exist.
 */
export function duplicateTreeItem(
  items: CollectionTreeItem[],
  itemId: string,
  generateId: (prefix: string) => string = generateAwjcId,
): { items: CollectionTreeItem[]; copy: CollectionTreeItem } | null {
  const original = findTreeItem(items, itemId);
  if (!original) return null;
  // All ids in the collection are taken, so every copied item is re-assigned.
  const takenIds = new Set(items.flatMap(collectTreeItemIds));
  const copied = reassignIds(original, takenIds, new Map(), generateId);
  const copy = { ...copied, name: `${original.name} (Copy)` };
  const next = insertTreeItem(items, copy, { targetId: itemId, position: 'after' });
  return next ? { items: next, copy } : null;
}

export interface CrossCollectionMoveResult {
  sourceItems: CollectionTreeItem[];
  targetItems: CollectionTreeItem[];
  /** Old id → id in the target collection, for every moved item (unchanged ids map to themselves). */
  idMap: Map<string, string>;
}

/**
 * Moves an item from one collection to another. Items whose ids already exist
 * in the target collection get fresh ids so the target stays unique.
 */
export function moveTreeItemBetweenCollections(
  sourceItems: CollectionTreeItem[],
  targetItems: CollectionTreeItem[],
  itemId: string,
  target: TreeDropTarget,
  generateId: (prefix: string) => string = generateAwjcId,
): CrossCollectionMoveResult | null {
  if (!canDropTreeItem(sourceItems, targetItems, itemId, target)) return null;
  const { items: nextSource, removed } = removeTreeItem(sourceItems, itemId);
  if (!removed) return null;

  const takenIds = new Set(targetItems.flatMap(collectTreeItemIds));
  const idMap = new Map<string, string>();
  const moved = reassignIds(removed, takenIds, idMap, generateId);
  const nextTarget = insertTreeItem(targetItems, moved, target);
  if (!nextTarget) return null;
  return { sourceItems: nextSource, targetItems: nextTarget, idMap };
}
