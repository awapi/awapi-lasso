import { useEffect, useMemo, useRef } from 'react';
import {
  generateAwjcId,
  type CollectionTreeItem,
  type RequestItem,
  type VariableEntry,
} from '../../shared/collectionSchema';
import type { HttpResponseResult } from '../../shared/httpTypes';
import type { AiToolWorkspace } from './aiToolHost';
import { collectWorkspaceSecretValues } from './aiContextBuilder';
import { getGraphqlSchemaForAi, loadGraphqlSchemaForAi } from './aiGraphqlSchema';
import type { WorkspaceCollectionEntry } from './components/CollectionSidebar';
import type { RequestWorkspaceTab } from './components/RequestTabBar';

export interface AiWorkspaceState {
  collections: WorkspaceCollectionEntry[];
  tabs: RequestWorkspaceTab[];
  activeTabId: string | null;
  activeCollectionPath: string | null;
  responsesByTab: Record<string, HttpResponseResult | null>;
  capturedVars: VariableEntry[];
}

export interface AiWorkspaceSetters {
  setCollections: (next: WorkspaceCollectionEntry[]) => void;
  setTabs: (next: RequestWorkspaceTab[]) => void;
  setActiveTabId: (id: string | null) => void;
  setActiveCollectionPath: (path: string | null) => void;
  /** Sends the active tab's request (the same code path as the Send button). */
  sendRequest: () => Promise<HttpResponseResult | null>;
}

function findRequest(items: CollectionTreeItem[], id: string): RequestItem | undefined {
  for (const item of items) {
    if (item.kind === 'request' && item.id === id) return item;
    if (item.kind === 'folder') {
      const found = findRequest(item.items, id);
      if (found) return found;
    }
  }
  return undefined;
}

function replaceRequest(items: CollectionTreeItem[], id: string, next: RequestItem): CollectionTreeItem[] {
  return items.map(item => {
    if (item.kind === 'request') return item.id === id ? next : item;
    return { ...item, items: replaceRequest(item.items, id, next) };
  });
}

function insertRequest(
  items: CollectionTreeItem[],
  request: RequestItem,
  parentFolderId?: string,
): CollectionTreeItem[] {
  if (!parentFolderId) return [...items, request];
  return items.map(item => {
    if (item.kind !== 'folder') return item;
    if (item.id === parentFolderId) return { ...item, items: [...item.items, request] };
    return { ...item, items: insertRequest(item.items, request, parentFolderId) };
  });
}

function removeFromTree(items: CollectionTreeItem[], id: string): CollectionTreeItem[] {
  return items
    .filter(item => item.id !== id)
    .map(item => (item.kind === 'folder' ? { ...item, items: removeFromTree(item.items, id) } : item));
}

/**
 * Adapts the app's React state to the assistant's tool interface. Mutations are mirrored into a ref
 * synchronously so back-to-back tool calls see each other's effects before React re-renders.
 * Credentials and the secret store are intentionally not part of this interface.
 */
export function useAiWorkspace(state: AiWorkspaceState, setters: AiWorkspaceSetters): AiToolWorkspace {
  const stateRef = useRef(state);
  const settersRef = useRef(setters);
  const commitWaiters = useRef<Array<() => void>>([]);
  stateRef.current = state;
  settersRef.current = setters;

  useEffect(() => {
    const waiters = commitWaiters.current;
    commitWaiters.current = [];
    waiters.forEach(resolve => resolve());
  });

  return useMemo<AiToolWorkspace>(() => {
    const commitCollections = (next: WorkspaceCollectionEntry[]) => {
      stateRef.current = { ...stateRef.current, collections: next };
      settersRef.current.setCollections(next);
    };
    const commitTabs = (next: RequestWorkspaceTab[]) => {
      stateRef.current = { ...stateRef.current, tabs: next };
      settersRef.current.setTabs(next);
    };
    const activate = (tabId: string, collectionPath: string | null) => {
      stateRef.current = { ...stateRef.current, activeTabId: tabId };
      settersRef.current.setActiveTabId(tabId);
      if (collectionPath) {
        stateRef.current = { ...stateRef.current, activeCollectionPath: collectionPath };
        settersRef.current.setActiveCollectionPath(collectionPath);
      }
    };
    const openInNewTab = (collectionPath: string, request: RequestItem) => {
      const tab: RequestWorkspaceTab = {
        id: generateAwjcId('tab'),
        collectionPath,
        request,
        savedRequest: request,
        isDirty: false,
      };
      commitTabs([...stateRef.current.tabs, tab]);
      activate(tab.id, collectionPath);
    };
    const waitForCommit = () =>
      new Promise<void>(resolve => {
        commitWaiters.current.push(resolve);
        setTimeout(resolve, 150);
      });

    return {
      getCollections: () => stateRef.current.collections,
      getActiveCollectionPath: () => stateRef.current.activeCollectionPath,
      getTabs: () => stateRef.current.tabs,
      getActiveTabId: () => stateRef.current.activeTabId,
      getGraphqlSchema: getGraphqlSchemaForAi,
      loadGraphqlSchema: loadGraphqlSchemaForAi,
      getResponse: tabId => stateRef.current.responsesByTab[tabId] ?? null,
      getSecretValues: () =>
        collectWorkspaceSecretValues({
          collections: stateRef.current.collections,
          tabs: stateRef.current.tabs,
          capturedVars: stateRef.current.capturedVars,
        }),

      updateRequest: (requestId, next) => {
        commitTabs(
          stateRef.current.tabs.map(t =>
            t.request.id === requestId ? { ...t, request: next, isDirty: true } : t,
          ),
        );
        commitCollections(
          stateRef.current.collections.map(entry =>
            findRequest(entry.collection.items, requestId)
              ? {
                  ...entry,
                  isDirty: true,
                  collection: { ...entry.collection, items: replaceRequest(entry.collection.items, requestId, next) },
                }
              : entry,
          ),
        );
      },

      updateCollection: (filePath, updater) => {
        commitCollections(
          stateRef.current.collections.map(entry =>
            entry.filePath === filePath ? { ...entry, isDirty: true, collection: updater(entry.collection) } : entry,
          ),
        );
      },

      addRequest: (filePath, parentFolderId, request) => {
        commitCollections(
          stateRef.current.collections.map(entry =>
            entry.filePath === filePath
              ? {
                  ...entry,
                  isDirty: true,
                  collection: {
                    ...entry.collection,
                    items: insertRequest(entry.collection.items, request, parentFolderId),
                  },
                }
              : entry,
          ),
        );
        openInNewTab(filePath, request);
      },

      removeRequest: (filePath, requestId) => {
        commitCollections(
          stateRef.current.collections.map(entry =>
            entry.filePath === filePath
              ? {
                  ...entry,
                  isDirty: true,
                  collection: { ...entry.collection, items: removeFromTree(entry.collection.items, requestId) },
                }
              : entry,
          ),
        );
        const remaining = stateRef.current.tabs.filter(t => t.request.id !== requestId);
        if (remaining.length !== stateRef.current.tabs.length) {
          const activeClosed = !remaining.some(t => t.id === stateRef.current.activeTabId);
          commitTabs(remaining);
          if (activeClosed) {
            const next = remaining[remaining.length - 1];
            stateRef.current = { ...stateRef.current, activeTabId: next?.id ?? null };
            settersRef.current.setActiveTabId(next?.id ?? null);
          }
        }
      },

      openRequest: requestId => {
        const existing = stateRef.current.tabs.find(t => t.request.id === requestId);
        if (existing) {
          activate(existing.id, existing.collectionPath);
          return true;
        }
        for (const entry of stateRef.current.collections) {
          const request = findRequest(entry.collection.items, requestId);
          if (request) {
            openInNewTab(entry.filePath, request);
            return true;
          }
        }
        return false;
      },

      sendActiveRequest: async () => {
        await waitForCommit();
        return settersRef.current.sendRequest();
      },
    };
  }, []);
}
