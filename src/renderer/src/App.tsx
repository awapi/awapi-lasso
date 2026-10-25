import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createDefaultFolder,
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
  createEmptyCollection,
  generateAwjcId,
  type AwjcCollection,
  type CollectionTreeItem,
  type RequestItem,
  type VariableEntry,
} from '../../shared/collectionSchema';
import { syncPathParamsFromUrl, syncQueryParamsFromUrl } from '../../shared/urlParams';
import type { HttpResponseResult } from '../../shared/httpTypes';
import type { VariableInterpolationContext } from '../../shared/interpolation';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { ResizableSplitPane } from './components/ResizableSplitPane';
import { TopToolbar } from './components/TopToolbar';
import {
  CollectionSidebar,
  type RequestHistoryEntry,
  type WorkspaceCollectionEntry,
} from './components/CollectionSidebar';
import { RequestTabBar, type RequestWorkspaceTab } from './components/RequestTabBar';
import { RequestUrlBar } from './components/RequestUrlBar';
import { RequestParamsTab } from './components/RequestParamsTab';
import { RequestHeadersTab } from './components/RequestHeadersTab';
import { RequestAuthTab } from './components/RequestAuthTab';
import { RequestBodyTab } from './components/RequestBodyTab';
import { GraphQLWorkspace } from './components/GraphQLWorkspace';
import { RequestCapturesTab } from './components/RequestCapturesTab';
import { RequestAssertionsTab } from './components/RequestAssertionsTab';
import {
  EnvironmentManagerModal,
  type EnvironmentModalTab,
} from './components/EnvironmentManagerModal';
import { CodeSnippetModal } from './components/CodeSnippetModal';
import { CollectionRunnerModal } from './components/CollectionRunnerModal';
import { ResponseInspector } from './components/ResponseInspector';
import { curlToRequestItem } from '../../shared/curlParser';

type RequestBuilderSectionTab =
  | 'params'
  | 'headers'
  | 'auth'
  | 'body'
  | 'captures'
  | 'assertions';

function updateItemInTree(
  items: CollectionTreeItem[],
  itemId: string,
  updater: (item: CollectionTreeItem) => CollectionTreeItem | null,
): CollectionTreeItem[] {
  const result: CollectionTreeItem[] = [];
  for (const item of items) {
    if (item.id === itemId) {
      const updated = updater(item);
      if (updated) result.push(updated);
      continue;
    }
    if (item.kind === 'folder') {
      result.push({
        ...item,
        items: updateItemInTree(item.items, itemId, updater),
      });
    } else {
      result.push(item);
    }
  }
  return result;
}

function insertItemIntoTree(
  items: CollectionTreeItem[],
  newItem: CollectionTreeItem,
  parentFolderId?: string,
): CollectionTreeItem[] {
  if (!parentFolderId) {
    return [...items, newItem];
  }
  return items.map(item => {
    if (item.kind === 'folder') {
      if (item.id === parentFolderId) {
        return { ...item, items: [...item.items, newItem] };
      }
      return { ...item, items: insertItemIntoTree(item.items, newItem, parentFolderId) };
    }
    return item;
  });
}

function findItemById(
  items: CollectionTreeItem[],
  itemId: string,
): CollectionTreeItem | undefined {
  for (const item of items) {
    if (item.id === itemId) return item;
    if (item.kind === 'folder') {
      const found = findItemById(item.items, itemId);
      if (found) return found;
    }
  }
  return undefined;
}

const WorkspaceShell: React.FC = () => {
  const { colors } = useTheme();
  const [collections, setCollections] = useState<WorkspaceCollectionEntry[]>([]);
  const [activeCollectionPath, setActiveCollectionPath] = useState<string | null>(null);

  const [tabs, setTabs] = useState<RequestWorkspaceTab[]>(() => {
    const initialReq = createDefaultHttpRequest({
      id: 'req_initial',
      name: 'Health Check',
      method: 'GET',
      url: 'http://127.0.0.1:8080/v1/health',
    });
    return [
      {
        id: 'tab_initial',
        collectionPath: null,
        request: initialReq,
        savedRequest: initialReq,
        isDirty: false,
      },
    ];
  });
  const [activeTabId, setActiveTabId] = useState<string | null>('tab_initial');
  const [closedTabs, setClosedTabs] = useState<RequestWorkspaceTab[]>([]);
  const [pendingCloseTabIds, setPendingCloseTabIds] = useState<string[] | null>(null);
  const [pendingCloseCollectionPath, setPendingCloseCollectionPath] = useState<string | null>(
    null,
  );
  const [activeConfigTab, setActiveConfigTab] = useState<RequestBuilderSectionTab>('params');

  const [historyEntries, setHistoryEntries] = useState<RequestHistoryEntry[]>([]);
  const [capturedVars, setCapturedVars] = useState<VariableEntry[]>([]);

  const [responsesByTab, setResponsesByTab] = useState<Record<string, HttpResponseResult | null>>(
    {},
  );
  const [prevResponsesByTab, setPrevResponsesByTab] = useState<
    Record<string, HttpResponseResult | null>
  >({});
  const [pinnedResponsesByTab, setPinnedResponsesByTab] = useState<
    Record<string, HttpResponseResult | null>
  >({});
  const [inFlightRequestId, setInFlightRequestId] = useState<string | null>(null);

  const [cliEnabled, setCliEnabled] = useState<boolean>(false);
  const [splitLayout, setSplitLayout] = useState<'vertical' | 'horizontal'>('vertical');
  const [envModalOpen, setEnvModalOpen] = useState<boolean>(false);
  const [envModalTab, setEnvModalTab] = useState<EnvironmentModalTab>('environments');
  const [codeSnippetModalOpen, setCodeSnippetModalOpen] = useState<boolean>(false);
  const [codeSnippetTargetRequest, setCodeSnippetTargetRequest] =
    useState<RequestItem | null>(null);
  const [runnerModalOpen, setRunnerModalOpen] = useState<boolean>(false);
  const [runnerInitialFolderId, setRunnerInitialFolderId] = useState<string | null>(null);
  const [importCurlModalOpen, setImportCurlModalOpen] = useState<boolean>(false);
  const [importCurlDraft, setImportCurlDraft] = useState<string>('');
  const [importCurlError, setImportCurlError] = useState<string | null>(null);
  const isSessionHydratedRef = useRef<boolean>(false);

  const loadCollectionFromDisk = useCallback(async (filePath: string): Promise<AwjcCollection> => {
    const api = window.electronAPI;
    let loadedCollection: AwjcCollection | null = null;
    if (api?.openCollectionFromPath) {
      try {
        const res = await api.openCollectionFromPath(filePath);
        if (res?.collection) {
          loadedCollection = res.collection;
        }
      } catch {
        // fallback to placeholder collection when path is synthetic in unit tests
      }
    }
    const fallbackName = filePath.split(/[/\\]/).pop() || filePath;
    return (
      loadedCollection ??
      createEmptyCollection(fallbackName, {
        metadata: { id: generateAwjcId('col'), name: fallbackName },
      })
    );
  }, []);

  const addCollectionByPath = useCallback(
    async (filePath: string) => {
      const col = await loadCollectionFromDisk(filePath);
      setCollections(prev => {
        if (prev.some(c => c.filePath === filePath)) return prev;
        return [...prev, { filePath, collection: col, isDirty: false }];
      });
      setActiveCollectionPath(prev => prev ?? filePath);
    },
    [loadCollectionFromDisk],
  );

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      isSessionHydratedRef.current = true;
      return;
    }

    let cancelled = false;

    const hydrateWorkspace = async () => {
      try {
        const [settings, savedSession] = await Promise.all([
          api.loadSettings?.() ?? Promise.resolve(null),
          api.loadSession?.() ?? Promise.resolve(null),
        ]);
        if (cancelled) return;

        const pathSet = new Set<string>();
        if (Array.isArray(savedSession?.openCollectionPaths)) {
          for (const fp of savedSession.openCollectionPaths) {
            if (fp) pathSet.add(fp);
          }
        }
        if (Array.isArray(settings?.openCollectionPaths)) {
          for (const fp of settings.openCollectionPaths) {
            if (fp) pathSet.add(fp);
          }
        }
        if (Array.isArray(savedSession?.tabs)) {
          for (const t of savedSession.tabs) {
            if (t.collectionPath) pathSet.add(t.collectionPath);
          }
        }

        const loadedByPath = new Map<string, AwjcCollection>();
        for (const fp of pathSet) {
          const col = await loadCollectionFromDisk(fp);
          const savedEnv = savedSession?.activeEnvironmentByCollection?.[fp];
          loadedByPath.set(
            fp,
            savedEnv !== undefined ? { ...col, activeEnvironment: savedEnv ?? undefined } : col,
          );
        }
        if (cancelled) return;

        if (savedSession) {
          const restoredCollectionPath =
            savedSession.activeCollectionPath ??
            Array.from(loadedByPath.keys())[0] ??
            null;
          if (restoredCollectionPath) {
            setActiveCollectionPath(restoredCollectionPath);
          }
          if (savedSession.activeConfigTab) {
            setActiveConfigTab(savedSession.activeConfigTab);
          }
          if (savedSession.splitLayout) {
            setSplitLayout(savedSession.splitLayout);
          }

          if (Array.isArray(savedSession.tabs)) {
            const restoredTabs: RequestWorkspaceTab[] = [];
            for (const st of savedSession.tabs) {
              const col = st.collectionPath ? loadedByPath.get(st.collectionPath) : undefined;
              const treeFound =
                col && st.requestId ? findItemById(col.items, st.requestId) : undefined;
              const savedReq =
                treeFound && treeFound.kind === 'request' ? treeFound : undefined;

              let draftReq: RequestItem | undefined;
              if (st.draftJson) {
                try {
                  const parsed = JSON.parse(st.draftJson) as Partial<RequestItem>;
                  if (parsed && typeof parsed === 'object') {
                    draftReq = createDefaultHttpRequest({
                      ...parsed,
                      id: parsed.id || st.requestId || generateAwjcId('req'),
                      name: parsed.name || st.title || 'Untitled Request',
                    });
                    if (parsed.protocol === 'graphql') {
                      draftReq = {
                        ...draftReq,
                        protocol: 'graphql',
                        graphql: parsed.graphql,
                      };
                    }
                  }
                } catch {
                  // ignore corrupt draft
                }
              }

              const activeReq =
                draftReq ??
                savedReq ??
                createDefaultHttpRequest({
                  id: st.requestId || generateAwjcId('req'),
                  name: st.title || 'Untitled Request',
                });

              if (col && st.collectionPath && st.isDirty && draftReq) {
                loadedByPath.set(st.collectionPath, {
                  ...col,
                  items: updateItemInTree(col.items, activeReq.id, () => activeReq),
                });
              }

              restoredTabs.push({
                id: st.id,
                collectionPath: st.collectionPath ?? null,
                request: activeReq,
                savedRequest: savedReq ?? activeReq,
                isDirty: Boolean(st.isDirty),
              });
            }

            setTabs(restoredTabs);
            const targetActiveId =
              savedSession.activeTabId &&
              restoredTabs.some(t => t.id === savedSession.activeTabId)
                ? savedSession.activeTabId
                : (restoredTabs[0]?.id ?? null);
            setActiveTabId(targetActiveId);
          }
        } else if (loadedByPath.size > 0) {
          const firstPath = Array.from(loadedByPath.keys())[0];
          setActiveCollectionPath(prev => prev ?? firstPath);
        }

        if (loadedByPath.size > 0) {
          const dirtyPaths = new Set(
            (savedSession?.tabs ?? [])
              .filter(t => t.isDirty && t.collectionPath)
              .map(t => t.collectionPath!),
          );
          setCollections(prev => {
            const next = [...prev];
            for (const [fp, col] of loadedByPath.entries()) {
              if (!next.some(c => c.filePath === fp)) {
                next.push({
                  filePath: fp,
                  collection: col,
                  isDirty: dirtyPaths.has(fp),
                });
              }
            }
            return next;
          });
        }
      } finally {
        if (!cancelled) {
          isSessionHydratedRef.current = true;
        }
      }
    };

    void hydrateWorkspace();

    void api.getCliCommandStatus?.().then(status => {
      if (status) setCliEnabled(status.enabled);
    });

    const unsubscribeOsOpen = api.onCollectionOpenedFromOs?.(filePath => {
      void addCollectionByPath(filePath);
    });
    const unsubscribeMenuOpen = api.onMenuOpenCollection?.(() => {
      void api.openCollectionDialog?.().then(async selected => {
        if (selected && selected.length > 0) {
          for (const fp of selected) {
            await addCollectionByPath(fp);
          }
        }
      });
    });
    const unsubscribeMenuCurl = api.onMenuImportCurl?.(() => {
      setImportCurlError(null);
      setImportCurlModalOpen(true);
    });
    const unsubscribeMenuOpenApi = api.onMenuImportOpenApi?.(() => {
      void api.importOpenApiWithDialog?.().then(res => {
        if (res?.collection) {
          const virtualPath = `${res.sourcePath}.awjc`;
          setCollections(prev => [
            ...prev,
            { filePath: virtualPath, collection: res.collection, isDirty: true },
          ]);
          setActiveCollectionPath(virtualPath);
        }
      });
    });

    return () => {
      cancelled = true;
      unsubscribeOsOpen?.();
      unsubscribeMenuOpen?.();
      unsubscribeMenuCurl?.();
      unsubscribeMenuOpenApi?.();
    };
  }, [addCollectionByPath, loadCollectionFromDisk]);

  useEffect(() => {
    if (!isSessionHydratedRef.current) return;
    const api = window.electronAPI;
    if (!api?.saveSession) return;

    const openCollectionPaths = collections.map(c => c.filePath);
    const activeEnvironmentByCollection: Record<string, string | null> = {};
    for (const c of collections) {
      activeEnvironmentByCollection[c.filePath] = c.collection.activeEnvironment ?? null;
    }

    void api.saveSession({
      activeTabId: activeTabId ?? null,
      activeCollectionPath: activeCollectionPath ?? null,
      activeEnvironmentByCollection,
      openCollectionPaths,
      activeConfigTab,
      splitLayout,
      tabs: tabs.map(t => ({
        id: t.id,
        title: t.request.name || 'Untitled Request',
        collectionPath: t.collectionPath ?? null,
        requestId: t.request.id ?? null,
        isDirty: Boolean(t.isDirty),
        ...(t.isDirty || !t.collectionPath ? { draftJson: JSON.stringify(t.request) } : {}),
      })),
    });
  }, [collections, activeCollectionPath, tabs, activeTabId, activeConfigTab, splitLayout]);

  const activeCollectionEntry = useMemo(
    () =>
      collections.find(c => c.filePath === activeCollectionPath) ?? collections[0] ?? null,
    [collections, activeCollectionPath],
  );

  const activeCollection = useMemo(
    () => activeCollectionEntry?.collection ?? createEmptyCollection('Default Workspace'),
    [activeCollectionEntry],
  );

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );

  const activeRequest = activeTab?.request ?? createDefaultHttpRequest();

  const interpolationContext = useMemo<VariableInterpolationContext>(() => {
    const activeEnv = (activeCollection.environments ?? []).find(
      e => e.name === activeCollection.activeEnvironment,
    );
    return {
      collectionVariables: activeCollection.variables ?? [],
      environmentVariables: activeEnv?.variables ?? [],
      capturedVariables: capturedVars,
    };
  }, [activeCollection, capturedVars]);

  const updateActiveRequest = (updater: (req: RequestItem) => RequestItem) => {
    if (!activeTab) return;
    const updatedReq = updater(activeTab.request);
    setTabs(prev =>
      prev.map(t => (t.id === activeTab.id ? { ...t, request: updatedReq, isDirty: true } : t)),
    );

    if (activeTab.collectionPath) {
      setCollections(prev =>
        prev.map(entry => {
          if (entry.filePath !== activeTab.collectionPath) return entry;
          return {
            ...entry,
            isDirty: true,
            collection: {
              ...entry.collection,
              items: updateItemInTree(entry.collection.items, updatedReq.id, () => updatedReq),
            },
          };
        }),
      );
    }
  };

  const handleOpenCollectionDialog = async () => {
    const selected = await window.electronAPI?.openCollectionDialog?.();
    if (selected && selected.length > 0) {
      for (const fp of selected) {
        await addCollectionByPath(fp);
      }
    }
  };

  const handleImportOpenApiDialog = async () => {
    const res = await window.electronAPI?.importOpenApiWithDialog?.();
    if (res?.collection) {
      const virtualPath = `${res.sourcePath}.awjc`;
      setCollections(prev => [
        ...prev,
        { filePath: virtualPath, collection: res.collection, isDirty: true },
      ]);
      setActiveCollectionPath(virtualPath);
    }
  };

  const handleNewCollection = () => {
    const idx = collections.length + 1;
    const col = createEmptyCollection(`New Collection ${idx}`, {
      items: [createDefaultHttpRequest({ name: 'Sample Request' })],
    });
    const virtualPath = `untitled-${idx}.awjc`;
    setCollections(prev => [...prev, { filePath: virtualPath, collection: col, isDirty: true }]);
    setActiveCollectionPath(virtualPath);
  };

  const handleSaveCollection = useCallback(
    async (filePath: string) => {
      const entry = collections.find(c => c.filePath === filePath);
      if (!entry || !window.electronAPI?.saveCollection) return;
      await window.electronAPI.saveCollection({
        filePath,
        collection: entry.collection,
      });
      setCollections(prev =>
        prev.map(c => (c.filePath === filePath ? { ...c, isDirty: false } : c)),
      );
      setTabs(prev =>
        prev.map(t =>
          t.collectionPath === filePath
            ? { ...t, savedRequest: t.request, isDirty: false }
            : t,
        ),
      );
    },
    [collections],
  );

  const performCloseTabs = useCallback(
    (tabIdsToClose: string[], discardChanges = false) => {
      const closeSet = new Set(tabIdsToClose);
      const targets = tabs.filter(t => closeSet.has(t.id));
      if (targets.length === 0) return;

      if (discardChanges) {
        for (const t of targets) {
          if (t.collectionPath && t.savedRequest) {
            const reverted = t.savedRequest;
            setCollections(prev =>
              prev.map(entry => {
                if (entry.filePath !== t.collectionPath) return entry;
                return {
                  ...entry,
                  collection: {
                    ...entry.collection,
                    items: updateItemInTree(
                      entry.collection.items,
                      reverted.id,
                      () => reverted,
                    ),
                  },
                };
              }),
            );
          }
        }
      }

                  const closedEntries = targets.map(t => {
                    const finalReq =
                      discardChanges && t.savedRequest ? t.savedRequest : t.request;
                    return {
                      ...t,
                      request: finalReq,
                      savedRequest: finalReq,
                      isDirty: false,
                    };
                  });
                  setClosedTabs(prev => [...closedEntries, ...prev]);

      const remaining = tabs.filter(t => !closeSet.has(t.id));
      setTabs(remaining);
      if (remaining.length === 0) {
        setActiveTabId(null);
      } else if (activeTabId && closeSet.has(activeTabId)) {
        setActiveTabId(remaining[remaining.length - 1].id);
      }
    },
    [tabs, activeTabId],
  );

  const requestCloseTabs = useCallback(
    (tabIdsToClose: string[]) => {
      const closeSet = new Set(tabIdsToClose);
      const dirtyTabs = tabs.filter(t => closeSet.has(t.id) && t.isDirty);
      if (dirtyTabs.length > 0) {
        setPendingCloseTabIds(tabIdsToClose);
        return;
      }
      performCloseTabs(tabIdsToClose, false);
    },
    [tabs, performCloseTabs],
  );

  const handleConfirmSaveAndCloseTabs = async () => {
    if (!pendingCloseTabIds) return;
    const idsToClose = pendingCloseTabIds;
    const closeSet = new Set(idsToClose);
    const dirtyTargets = tabs.filter(t => closeSet.has(t.id) && t.isDirty);

    const collectionPathsToSave = new Set<string>();
    for (const t of dirtyTargets) {
      if (t.collectionPath) {
        collectionPathsToSave.add(t.collectionPath);
      } else if (activeCollectionEntry) {
        collectionPathsToSave.add(activeCollectionEntry.filePath);
      }
    }

    for (const fp of collectionPathsToSave) {
      await handleSaveCollection(fp);
    }

    setPendingCloseTabIds(null);
    performCloseTabs(idsToClose, false);
  };

  const handleConfirmDiscardAndCloseTabs = () => {
    if (!pendingCloseTabIds) return;
    const idsToClose = pendingCloseTabIds;
    setPendingCloseTabIds(null);
    performCloseTabs(idsToClose, true);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 's' && !e.shiftKey) {
        const targetPath = activeTab?.collectionPath ?? activeCollectionEntry?.filePath;
        if (targetPath) {
          e.preventDefault();
          void handleSaveCollection(targetPath);
        } else if (activeTab?.isDirty) {
          e.preventDefault();
          setTabs(prev =>
            prev.map(t =>
              t.id === activeTab.id
                ? { ...t, savedRequest: t.request, isDirty: false }
                : t,
            ),
          );
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, activeCollectionEntry, handleSaveCollection]);

  const handleExportCollection = async (filePath: string, format: 'yaml' | 'json') => {
    const entry = collections.find(c => c.filePath === filePath);
    if (!entry || !window.electronAPI?.saveCollectionAs) return;
    await window.electronAPI.saveCollectionAs({
      defaultPath: filePath,
      collection: entry.collection,
      format,
    });
  };

  const performCloseCollection = useCallback((filePath: string) => {
    setCollections(prev => {
      const remaining = prev.filter(c => c.filePath !== filePath);
      setActiveCollectionPath(curr =>
        curr === filePath ? (remaining[0]?.filePath ?? null) : curr,
      );
      return remaining;
    });
    setTabs(prev => {
      const remainingTabs = prev.filter(t => t.collectionPath !== filePath);
      setActiveTabId(curr =>
        curr && !remainingTabs.some(t => t.id === curr)
          ? (remainingTabs[remainingTabs.length - 1]?.id ?? null)
          : curr,
      );
      return remainingTabs;
    });
  }, []);

  const handleCloseCollection = useCallback(
    (filePath: string) => {
      const colEntry = collections.find(c => c.filePath === filePath);
      const hasDirtyTabForCollection = tabs.some(
        t => t.collectionPath === filePath && t.isDirty,
      );
      if (colEntry?.isDirty || hasDirtyTabForCollection) {
        setPendingCloseCollectionPath(filePath);
        return;
      }
      performCloseCollection(filePath);
    },
    [collections, tabs, performCloseCollection],
  );

  const handleConfirmSaveAndCloseCollection = async () => {
    if (!pendingCloseCollectionPath) return;
    const fp = pendingCloseCollectionPath;
    await handleSaveCollection(fp);
    setPendingCloseCollectionPath(null);
    performCloseCollection(fp);
  };

  const handleConfirmDiscardAndCloseCollection = () => {
    if (!pendingCloseCollectionPath) return;
    const fp = pendingCloseCollectionPath;
    setPendingCloseCollectionPath(null);
    performCloseCollection(fp);
  };

  const handleSelectRequestFromTree = (collectionPath: string, req: RequestItem) => {
    setActiveCollectionPath(collectionPath);
    if (req.protocol === 'graphql') {
      setActiveConfigTab('body');
    }
    const existingTab = tabs.find(
      t => t.collectionPath === collectionPath && t.request.id === req.id,
    );
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }
    const newTabId = generateAwjcId('tab');
    setTabs(prev => [
      ...prev,
      {
        id: newTabId,
        collectionPath,
        request: req,
        savedRequest: req,
        isDirty: false,
      },
    ]);
    setActiveTabId(newTabId);
  };

  const handleSendRequest = async () => {
    if (!window.electronAPI?.sendHttpRequest || !activeTab) return;
    const reqId = generateAwjcId('inflight');
    setInFlightRequestId(reqId);

    try {
      const response = await window.electronAPI.sendHttpRequest({
        requestId: reqId,
        protocol: activeRequest.protocol,
        method: activeRequest.method,
        url: activeRequest.url,
        queryParams: activeRequest.queryParams,
        pathParams: activeRequest.pathParams,
        headers: activeRequest.headers,
        inheritedHeaders: activeCollection.defaults?.headers ?? [],
        auth: activeRequest.auth,
        collectionDefaultAuth: activeCollection.defaults?.auth,
        authProfiles: activeCollection.authProfiles,
        body: activeRequest.body,
        graphql: activeRequest.graphql,
        captures: activeRequest.captures,
        assertions: activeRequest.assertions,
        interpolationContext,
        collectionId: activeCollection.metadata.id,
        environmentId: activeCollection.activeEnvironment,
      });

      setPrevResponsesByTab(prev => ({
        ...prev,
        [activeTab.id]: responsesByTab[activeTab.id] ?? null,
      }));
      setResponsesByTab(prev => ({
        ...prev,
        [activeTab.id]: response,
      }));

      if (Array.isArray(response?.captures) && response.captures.length > 0) {
        setCapturedVars(prev => {
          const next = [...prev];
          for (const cap of response.captures) {
            if (cap.matched && cap.value !== null) {
              const existingIdx = next.findIndex(v => v.key === cap.variable);
              const entry: VariableEntry = {
                key: cap.variable,
                value: cap.value,
                enabled: true,
                secret: cap.secret,
              };
              if (existingIdx !== -1) {
                next[existingIdx] = entry;
              } else {
                next.push(entry);
              }
            }
          }
          return next;
        });
      }

      setHistoryEntries(prev => [
        {
          id: generateAwjcId('hist'),
          timestamp: new Date().toISOString(),
          method: activeRequest.method,
          protocol: activeRequest.protocol,
          url: activeRequest.url,
          status: response?.status,
          durationMs: response?.timings?.totalMs,
          requestSnapshot: activeRequest,
        },
        ...prev,
      ]);
    } finally {
      setInFlightRequestId(null);
    }
  };

  const handleCancelRequest = async () => {
    if (inFlightRequestId && window.electronAPI?.cancelHttpRequest) {
      await window.electronAPI.cancelHttpRequest(inFlightRequestId);
    }
    setInFlightRequestId(null);
  };

  return (
    <div
      data-testid="awapilasso-app"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        backgroundColor: colors.bgPrimary,
        color: colors.textPrimary,
        overflow: 'hidden',
      }}
    >
      {/* Top Toolbar */}
      <TopToolbar
        activeCollectionName={activeCollectionEntry?.collection.metadata.name}
        activeCollectionPath={activeCollectionEntry?.filePath}
        environments={activeCollection.environments ?? []}
        activeEnvironmentName={activeCollection.activeEnvironment}
        onSelectEnvironment={envName => {
          if (!activeCollectionEntry) return;
          setCollections(prev =>
            prev.map(c =>
              c.filePath === activeCollectionEntry.filePath
                ? {
                    ...c,
                    collection: { ...c.collection, activeEnvironment: envName },
                  }
                : c,
            ),
          );
        }}
        onOpenEnvironmentManager={() => {
          setEnvModalTab('environments');
          setEnvModalOpen(true);
        }}
        onOpenPreferences={() => {
          setEnvModalTab('environments');
          setEnvModalOpen(true);
        }}
        onOpenCollectionRunner={() => {
          setRunnerInitialFolderId(null);
          setRunnerModalOpen(true);
        }}
        onOpenImportOpenApi={() => void handleImportOpenApiDialog()}
        onOpenImportCurl={() => {
          setImportCurlError(null);
          setImportCurlModalOpen(true);
        }}
        cliEnabled={cliEnabled}
        splitLayout={splitLayout}
        onToggleSplitLayout={() =>
          setSplitLayout(prev => (prev === 'vertical' ? 'horizontal' : 'vertical'))
        }
      />

      {/* Main Split Workspace: Left Sidebar <-> Right Request/Response Area */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ResizableSplitPane
          testId="workspace-split"
          direction="horizontal"
          initialSize={270}
          minSize={200}
          maxSize={500}
          collapsible
          firstPane={
            <CollectionSidebar
              collections={collections}
              activeCollectionPath={activeCollectionPath}
              activeRequestId={activeRequest.id}
              historyEntries={historyEntries}
              onSelectCollection={fp => setActiveCollectionPath(fp)}
              onSelectRequest={handleSelectRequestFromTree}
              onSelectHistoryEntry={entry => {
                if (entry.requestSnapshot) {
                  const newTabId = generateAwjcId('tab');
                  setTabs(prev => [
                    ...prev,
                    { id: newTabId, collectionPath: null, request: entry.requestSnapshot! },
                  ]);
                  setActiveTabId(newTabId);
                }
              }}
              onSaveHistoryEntryToCollection={entry => {
                if (!entry.requestSnapshot || !activeCollectionEntry) return;
                const savedCopy: RequestItem = {
                  ...entry.requestSnapshot,
                  id: generateAwjcId('req'),
                };
                setCollections(prev =>
                  prev.map(c =>
                    c.filePath === activeCollectionEntry.filePath
                      ? {
                          ...c,
                          isDirty: true,
                          collection: {
                            ...c.collection,
                            items: [...c.collection.items, savedCopy],
                          },
                        }
                      : c,
                  ),
                );
                handleSelectRequestFromTree(activeCollectionEntry.filePath, savedCopy);
              }}
              onClearHistory={() => setHistoryEntries([])}
              onNewCollection={handleNewCollection}
              onImportCollection={() => void handleOpenCollectionDialog()}
              onRunCollection={(fp, folderId) => {
                setActiveCollectionPath(fp);
                setRunnerInitialFolderId(folderId ?? null);
                setRunnerModalOpen(true);
              }}
              onSaveCollection={fp => void handleSaveCollection(fp)}
              onExportCollection={(fp, fmt) => void handleExportCollection(fp, fmt)}
              onCloseCollection={handleCloseCollection}
              onNewHttpRequest={(fp, parentFolderId) => {
                const newReq = createDefaultHttpRequest();
                setCollections(prev =>
                  prev.map(c =>
                    c.filePath === fp
                      ? {
                          ...c,
                          isDirty: true,
                          collection: {
                            ...c.collection,
                            items: insertItemIntoTree(c.collection.items, newReq, parentFolderId),
                          },
                        }
                      : c,
                  ),
                );
                handleSelectRequestFromTree(fp, newReq);
              }}
              onNewGraphQLRequest={(fp, parentFolderId) => {
                const newReq = createDefaultGraphQLRequest();
                setCollections(prev =>
                  prev.map(c =>
                    c.filePath === fp
                      ? {
                          ...c,
                          isDirty: true,
                          collection: {
                            ...c.collection,
                            items: insertItemIntoTree(c.collection.items, newReq, parentFolderId),
                          },
                        }
                      : c,
                  ),
                );
                handleSelectRequestFromTree(fp, newReq);
              }}
              onNewFolder={(fp, parentFolderId) => {
                const newFld = createDefaultFolder();
                setCollections(prev =>
                  prev.map(c =>
                    c.filePath === fp
                      ? {
                          ...c,
                          isDirty: true,
                          collection: {
                            ...c.collection,
                            items: insertItemIntoTree(c.collection.items, newFld, parentFolderId),
                          },
                        }
                      : c,
                  ),
                );
              }}
              onDuplicateItem={(fp, itemId) => {
                setCollections(prev =>
                  prev.map(c => {
                    if (c.filePath !== fp) return c;
                    const found = findItemById(c.collection.items, itemId);
                    if (!found) return c;
                    const copy: CollectionTreeItem = {
                      ...found,
                      id: generateAwjcId(found.kind === 'folder' ? 'fld' : 'req'),
                      name: `${found.name} (Copy)`,
                    };
                    return {
                      ...c,
                      isDirty: true,
                      collection: {
                        ...c.collection,
                        items: [...c.collection.items, copy],
                      },
                    };
                  }),
                );
              }}
              onRenameItem={(fp, itemId, newName) => {
                setCollections(prev =>
                  prev.map(c =>
                    c.filePath === fp
                      ? {
                          ...c,
                          isDirty: true,
                          collection: {
                            ...c.collection,
                            items: updateItemInTree(c.collection.items, itemId, item => ({
                              ...item,
                              name: newName,
                            })),
                          },
                        }
                      : c,
                  ),
                );
              }}
              onDeleteItem={(fp, itemId) => {
                setCollections(prev =>
                  prev.map(c =>
                    c.filePath === fp
                      ? {
                          ...c,
                          isDirty: true,
                          collection: {
                            ...c.collection,
                            items: updateItemInTree(c.collection.items, itemId, () => null),
                          },
                        }
                      : c,
                  ),
                );
              }}
              onGenerateCodeForRequest={(fp, req) => {
                setActiveCollectionPath(fp);
                setCodeSnippetTargetRequest(req);
                setCodeSnippetModalOpen(true);
              }}
            />
          }
          secondPane={
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0 }}>
              {/* Multi-Tab Request Bar */}
              <RequestTabBar
                tabs={tabs}
                activeTabId={activeTab?.id ?? null}
                hasClosedTabs={closedTabs.length > 0}
                onSelectTab={setActiveTabId}
                onNewTab={() => {
                  const newTabId = generateAwjcId('tab');
                  const newReq = createDefaultHttpRequest();
                  setTabs(prev => [
                    ...prev,
                    {
                      id: newTabId,
                      collectionPath: activeCollectionPath,
                      request: newReq,
                      savedRequest: newReq,
                      isDirty: false,
                    },
                  ]);
                  setActiveTabId(newTabId);
                }}
                onCloseTab={tabId => {
                  requestCloseTabs([tabId]);
                }}
                onCloseOtherTabs={tabId => {
                  const otherIds = tabs.filter(t => t.id !== tabId).map(t => t.id);
                  requestCloseTabs(otherIds);
                  setActiveTabId(tabId);
                }}
                onCloseAllTabs={() => {
                  requestCloseTabs(tabs.map(t => t.id));
                }}
                onReopenClosedTab={() => {
                  if (closedTabs.length === 0) return;
                  const [mostRecent, ...rest] = closedTabs;
                  setClosedTabs(rest);
                  setTabs(prev => [...prev, mostRecent]);
                  setActiveTabId(mostRecent.id);
                }}
                onReorderTabs={(fromIdx, toIdx) => {
                  setTabs(prev => {
                    const next = [...prev];
                    const [moved] = next.splice(fromIdx, 1);
                    next.splice(toIdx, 0, moved);
                    return next;
                  });
                }}
                onGenerateCodeForTab={tab => {
                  if (tab.collectionPath) {
                    setActiveCollectionPath(tab.collectionPath);
                  }
                  setCodeSnippetTargetRequest(tab.request);
                  setCodeSnippetModalOpen(true);
                }}
              />

              {/* Split Pane: Request Builder (Top/Left) <-> Response Inspector (Bottom/Right) */}
              <div style={{ flex: 1, minHeight: 0 }}>
                {!activeTab ? (
                  <div
                    data-testid="empty-tabs-workspace"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      gap: 12,
                      color: colors.textSecondary,
                      fontSize: 13,
                    }}
                  >
                    <div>No open request tabs. Select a request from the sidebar or create a new one.</div>
                    <button
                      type="button"
                      data-testid="empty-workspace-new-tab-btn"
                      onClick={() => {
                        const newTabId = generateAwjcId('tab');
                        setTabs([
                          {
                            id: newTabId,
                            collectionPath: activeCollectionPath,
                            request: createDefaultHttpRequest(),
                            isDirty: false,
                          },
                        ]);
                        setActiveTabId(newTabId);
                      }}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 6,
                        border: 'none',
                        backgroundColor: colors.accent,
                        color: '#ffffff',
                        fontWeight: 600,
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      + New Request
                    </button>
                  </div>
                ) : (
                  <ResizableSplitPane
                    testId="request-response-split"
                    direction={splitLayout}
                    initialSize={360}
                    minSize={200}
                    maxSize={720}
                    firstPane={
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          height: '100%',
                          overflow: 'hidden',
                        }}
                      >
                        {/* Sticky Header: Request URL Bar & Configuration Section Tabs */}
                        <div
                          data-testid="request-sticky-header"
                          style={{
                            flexShrink: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12,
                            padding: '12px 12px 0 12px',
                            backgroundColor: colors.bgPrimary,
                            zIndex: 10,
                          }}
                        >
                          {/* Request URL Bar */}
                          <RequestUrlBar
                            method={activeRequest.method}
                            protocol={activeRequest.protocol}
                            url={activeRequest.url}
                            pathParams={activeRequest.pathParams}
                            interpolationContext={interpolationContext}
                            isSending={Boolean(inFlightRequestId)}
                            onMethodChange={(method, protocol) => {
                              const nextProtocol = protocol ?? activeRequest.protocol;
                              updateActiveRequest(r => ({
                                ...r,
                                method,
                                protocol: nextProtocol,
                                graphql:
                                  nextProtocol === 'graphql' && !r.graphql
                                    ? {
                                        query: 'query NewQuery {\n  __typename\n}\n',
                                        variables: '{}',
                                        schemaSource: {
                                          mode: 'introspect',
                                          autoIntrospectOnOpen: true,
                                        },
                                      }
                                    : r.graphql,
                              }));
                              if (nextProtocol === 'graphql') {
                                setActiveConfigTab('body');
                              }
                            }}
                            onUrlChange={nextUrl =>
                              updateActiveRequest(r => ({
                                ...r,
                                url: nextUrl,
                                queryParams: syncQueryParamsFromUrl(nextUrl, r.queryParams ?? []),
                                pathParams: syncPathParamsFromUrl(nextUrl, r.pathParams ?? []),
                              }))
                            }
                            onSend={() => void handleSendRequest()}
                            onCancel={() => void handleCancelRequest()}
                            onEditVariable={() => {
                              setEnvModalTab('environments');
                              setEnvModalOpen(true);
                            }}
                            onPasteCurl={parsed => {
                              updateActiveRequest(r => ({
                                ...r,
                                protocol: 'http',
                                method: parsed.method,
                                url: parsed.url,
                                queryParams: parsed.queryParams,
                                pathParams: parsed.pathParams,
                                headers: parsed.headers,
                                auth: parsed.auth,
                                body: parsed.body,
                              }));
                            }}
                            onOpenCodeSnippet={() => {
                              setCodeSnippetTargetRequest(activeRequest);
                              setCodeSnippetModalOpen(true);
                            }}
                          />

                          {/* Request Configuration Section Tabs */}
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              borderBottom: `1px solid ${colors.border}`,
                              paddingBottom: 6,
                              flexWrap: 'wrap',
                            }}
                          >
                            {(
                              [
                                { id: 'params', label: 'Params' },
                                {
                                  id: 'headers',
                                  label: `Headers (${(activeRequest.headers ?? []).length})`,
                                },
                                { id: 'auth', label: 'Auth / OAuth 2.0' },
                                {
                                  id: 'body',
                                  label:
                                    activeRequest.protocol === 'graphql'
                                      ? 'GraphQL (Designer & Query)'
                                      : 'Body',
                                },
                                {
                                  id: 'captures',
                                  label: `Captures (${(activeRequest.captures ?? []).length})`,
                                },
                                {
                                  id: 'assertions',
                                  label: `Assertions (${(activeRequest.assertions ?? []).length})`,
                                },
                              ] as Array<{ id: RequestBuilderSectionTab; label: string }>
                            ).map(sec => {
                              const isActive = activeConfigTab === sec.id;
                              return (
                                <button
                                  key={sec.id}
                                  type="button"
                                  data-testid={`req-config-tab-${sec.id}`}
                                  onClick={() => setActiveConfigTab(sec.id)}
                                  style={{
                                    padding: '5px 10px',
                                    borderRadius: 6,
                                    border: 'none',
                                    backgroundColor: isActive ? `${colors.accent}22` : 'transparent',
                                    color: isActive ? colors.accent : colors.textSecondary,
                                    fontSize: 12,
                                    fontWeight: isActive ? 700 : 500,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {sec.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Active Request Configuration Panel */}
                        <div
                          data-testid="request-config-scroll-container"
                          style={{
                            flex: 1,
                            minHeight: 0,
                            overflowY: 'auto',
                            padding: 12,
                          }}
                        >
                          {activeConfigTab === 'params' && (
                            <RequestParamsTab
                              url={activeRequest.url}
                              queryParams={activeRequest.queryParams ?? []}
                              pathParams={activeRequest.pathParams ?? []}
                              onChange={next =>
                                updateActiveRequest(r => ({
                                  ...r,
                                  url: next.url,
                                  queryParams: next.queryParams,
                                  pathParams: next.pathParams,
                                }))
                              }
                            />
                          )}

                          {activeConfigTab === 'headers' && (
                            <RequestHeadersTab
                              headers={activeRequest.headers ?? []}
                              inheritedHeaders={(activeCollection.defaults?.headers ?? []).map(
                                h => ({
                                  ...h,
                                  sourceName: 'Collection Defaults',
                                }),
                              )}
                              onChange={headers => updateActiveRequest(r => ({ ...r, headers }))}
                            />
                          )}

                          {activeConfigTab === 'auth' && (
                            <RequestAuthTab
                              auth={activeRequest.auth ?? { type: 'inherit' }}
                              authProfiles={activeCollection.authProfiles}
                              interpolationContext={interpolationContext}
                              onChange={auth => updateActiveRequest(r => ({ ...r, auth }))}
                            />
                          )}

                          {activeConfigTab === 'body' &&
                            (activeRequest.protocol === 'graphql' ? (
                              <GraphQLWorkspace
                                graphql={
                                  activeRequest.graphql ?? {
                                    query: '',
                                    variables: '{}',
                                    schemaSource: {
                                      mode: 'introspect',
                                      autoIntrospectOnOpen: true,
                                    },
                                  }
                                }
                                onChange={graphql =>
                                  updateActiveRequest(r => ({ ...r, graphql }))
                                }
                                url={activeRequest.url}
                                queryParams={activeRequest.queryParams}
                                pathParams={activeRequest.pathParams}
                                headers={activeRequest.headers}
                                inheritedHeaders={activeCollection.defaults?.headers ?? []}
                                auth={activeRequest.auth}
                                collectionDefaultAuth={activeCollection.defaults?.auth}
                                authProfiles={activeCollection.authProfiles}
                                interpolationContext={interpolationContext}
                                collectionId={activeCollection.metadata.id}
                                environmentId={activeCollection.activeEnvironment}
                                collectionFilePath={activeCollectionEntry?.filePath}
                              />
                            ) : (
                              <RequestBodyTab
                                body={activeRequest.body ?? { mode: 'none' }}
                                onChange={body => updateActiveRequest(r => ({ ...r, body }))}
                              />
                            ))}

                          {activeConfigTab === 'captures' && (
                            <RequestCapturesTab
                              captures={activeRequest.captures ?? []}
                              onChange={captures => updateActiveRequest(r => ({ ...r, captures }))}
                            />
                          )}

                          {activeConfigTab === 'assertions' && (
                            <RequestAssertionsTab
                              assertions={activeRequest.assertions ?? []}
                              onChange={assertions =>
                                updateActiveRequest(r => ({ ...r, assertions }))
                              }
                            />
                          )}
                        </div>
                      </div>
                    }
                    secondPane={
                      <ResponseInspector
                        response={activeTab ? (responsesByTab[activeTab.id] ?? null) : null}
                        previousResponse={
                          activeTab ? (prevResponsesByTab[activeTab.id] ?? null) : null
                        }
                        pinnedResponse={
                          activeTab ? (pinnedResponsesByTab[activeTab.id] ?? null) : null
                        }
                        onPinResponse={resp => {
                          if (!activeTab) return;
                          setPinnedResponsesByTab(prev => ({
                            ...prev,
                            [activeTab.id]: resp,
                          }));
                        }}
                      />
                    }
                  />
                )}
              </div>
            </div>
          }
        />
      </div>

      {/* Unsaved Tab Changes Confirmation Modal */}
      {pendingCloseTabIds && pendingCloseTabIds.length > 0 && (() => {
        const closeSet = new Set(pendingCloseTabIds);
        const dirtyClosingTabs = tabs.filter(t => closeSet.has(t.id) && t.isDirty);
        const singleTab = dirtyClosingTabs.length === 1 ? dirtyClosingTabs[0] : null;

        return (
          <div
            data-testid="unsaved-tab-close-modal-backdrop"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200,
              backgroundColor: 'rgba(0, 0, 0, 0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Unsaved Changes"
              data-testid="unsaved-tab-close-modal"
              style={{
                width: '100%',
                maxWidth: 440,
                backgroundColor: colors.bgPrimary,
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15, color: colors.textPrimary }}>
                {singleTab
                  ? `Do you want to save the changes you made to "${singleTab.request.name || 'Untitled Request'}"?`
                  : `Do you want to save changes to ${dirtyClosingTabs.length} modified requests?`}
              </div>

              <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>
                Your changes will be lost if you don&apos;t save them.
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  data-testid="unsaved-modal-cancel-btn"
                  onClick={() => setPendingCloseTabIds(null)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: 'transparent',
                    color: colors.textPrimary,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  data-testid="unsaved-modal-discard-btn"
                  onClick={handleConfirmDiscardAndCloseTabs}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: `1px solid ${colors.danger}`,
                    backgroundColor: 'transparent',
                    color: colors.danger,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Don&apos;t Save
                </button>

                <button
                  type="button"
                  data-testid="unsaved-modal-save-btn"
                  onClick={() => void handleConfirmSaveAndCloseTabs()}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: colors.accent,
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unsaved Collection Changes Confirmation Modal */}
      {pendingCloseCollectionPath && (() => {
        const closingColEntry = collections.find(c => c.filePath === pendingCloseCollectionPath);
        const colName =
          closingColEntry?.collection.metadata.name || pendingCloseCollectionPath;

        return (
          <div
            data-testid="unsaved-collection-close-modal-backdrop"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200,
              backgroundColor: 'rgba(0, 0, 0, 0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 20,
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Unsaved Collection Changes"
              data-testid="unsaved-collection-close-modal"
              style={{
                width: '100%',
                maxWidth: 440,
                backgroundColor: colors.bgPrimary,
                border: `1px solid ${colors.border}`,
                borderRadius: 10,
                padding: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15, color: colors.textPrimary }}>
                {`Do you want to save the changes you made to collection "${colName}" before closing it?`}
              </div>

              <div style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 1.5 }}>
                Your unsaved changes to this collection or its requests will be lost if you don&apos;t save them.
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 4,
                }}
              >
                <button
                  type="button"
                  data-testid="unsaved-collection-modal-cancel-btn"
                  onClick={() => setPendingCloseCollectionPath(null)}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: `1px solid ${colors.border}`,
                    backgroundColor: 'transparent',
                    color: colors.textPrimary,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  data-testid="unsaved-collection-modal-discard-btn"
                  onClick={handleConfirmDiscardAndCloseCollection}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: `1px solid ${colors.danger}`,
                    backgroundColor: 'transparent',
                    color: colors.danger,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Don&apos;t Save
                </button>

                <button
                  type="button"
                  data-testid="unsaved-collection-modal-save-btn"
                  onClick={() => void handleConfirmSaveAndCloseCollection()}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    border: 'none',
                    backgroundColor: colors.accent,
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Save &amp; Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Environments, Variables & Secrets Manager Modal */}
      <EnvironmentManagerModal
        isOpen={envModalOpen}
        initialTab={envModalTab}
        collection={activeCollection}
        onUpdateCollection={updatedCol => {
          if (!activeCollectionEntry) return;
          setCollections(prev =>
            prev.map(c =>
              c.filePath === activeCollectionEntry.filePath
                ? { ...c, isDirty: true, collection: updatedCol }
                : c,
            ),
          );
        }}
        onClose={() => setEnvModalOpen(false)}
      />

      {/* Code Snippet Generator Modal */}
      <CodeSnippetModal
        isOpen={codeSnippetModalOpen}
        request={codeSnippetTargetRequest ?? activeRequest}
        interpolationContext={interpolationContext}
        inheritedHeaders={activeCollection.defaults?.headers ?? []}
        collectionDefaultAuth={activeCollection.defaults?.auth}
        authProfiles={activeCollection.authProfiles}
        onClose={() => {
          setCodeSnippetModalOpen(false);
          setCodeSnippetTargetRequest(null);
        }}
      />

      {/* Collection / Folder Runner Modal */}
      <CollectionRunnerModal
        isOpen={runnerModalOpen}
        collection={activeCollection}
        initialFolderId={runnerInitialFolderId}
        initialCapturedVariables={capturedVars}
        onUpdateCapturedVariables={setCapturedVars}
        onClose={() => {
          setRunnerModalOpen(false);
          setRunnerInitialFolderId(null);
        }}
      />

      {/* Import cURL Modal */}
      {importCurlModalOpen && (
        <div
          data-testid="import-curl-modal-backdrop"
          onClick={() => setImportCurlModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 190,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Import cURL Command"
            data-testid="import-curl-modal"
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 640,
              backgroundColor: colors.bgPrimary,
              border: `1px solid ${colors.border}`,
              borderRadius: 10,
              padding: 18,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              boxShadow: '0 20px 50px rgba(0, 0, 0, 0.45)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14 }}>Import cURL Command</div>
            <textarea
              data-testid="import-curl-textarea"
              aria-label="cURL Command Input"
              rows={6}
              value={importCurlDraft}
              onChange={e => {
                setImportCurlDraft(e.target.value);
                setImportCurlError(null);
              }}
              placeholder="curl -X POST https://api.example.com/v1/orders -H 'Content-Type: application/json' -d '{&quot;sku&quot;:&quot;A1&quot;}'"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: 10,
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgSecondary,
                color: colors.textPrimary,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            />
            {importCurlError && (
              <div
                data-testid="import-curl-error"
                style={{ color: colors.danger, fontSize: 12 }}
              >
                {importCurlError}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                data-testid="cancel-import-curl-btn"
                onClick={() => setImportCurlModalOpen(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 6,
                  border: `1px solid ${colors.border}`,
                  backgroundColor: 'transparent',
                  color: colors.textPrimary,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="confirm-import-curl-btn"
                onClick={() => {
                  try {
                    const importedReq = curlToRequestItem(importCurlDraft);
                    const newTabId = generateAwjcId('tab');
                    setTabs(prev => [
                      ...prev,
                      {
                        id: newTabId,
                        collectionPath: activeCollectionPath,
                        request: importedReq,
                        savedRequest: importedReq,
                        isDirty: true,
                      },
                    ]);
                    setActiveTabId(newTabId);
                    setImportCurlDraft('');
                    setImportCurlModalOpen(false);
                  } catch (err) {
                    setImportCurlError(
                      err instanceof Error ? err.message : 'Invalid cURL command',
                    );
                  }
                }}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: colors.accent,
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Import into Request Tab
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <WorkspaceShell />
    </ThemeProvider>
  );
};

export default App;

