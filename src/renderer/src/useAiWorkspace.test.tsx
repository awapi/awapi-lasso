import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  createDefaultHttpRequest,
  createEmptyCollection,
  type RequestItem,
} from '../../shared/collectionSchema';
import type { HttpResponseResult } from '../../shared/httpTypes';
import type { AiToolWorkspace } from './aiToolHost';
import type { WorkspaceCollectionEntry } from './components/CollectionSidebar';
import type { RequestWorkspaceTab } from './components/RequestTabBar';
import { useAiWorkspace } from './useAiWorkspace';
import { publishGraphqlSchemaForAi } from './aiGraphqlSchema';
import { loadSchemaFromSdl } from '../../shared/graphqlSchemaLoader';

function setup() {
  const inFolder = createDefaultHttpRequest({ id: 'req_folder', name: 'In folder' });
  const root = createDefaultHttpRequest({ id: 'req_root', name: 'Root' });
  const collection = createEmptyCollection('C', {
    items: [{ kind: 'folder', id: 'fld', name: 'F', items: [inFolder] }, root],
    environments: [{ id: 'e', name: 'dev', variables: [{ key: 'apiToken', value: 'env-token-1', enabled: true }] }],
  });
  const sendRequest = vi.fn().mockResolvedValue({ status: 200 } as HttpResponseResult);
  const probe: {
    ws: AiToolWorkspace;
    collections: WorkspaceCollectionEntry[];
    tabs: RequestWorkspaceTab[];
    activeTabId: string | null;
    activeCollectionPath: string | null;
  } = {} as never;

  const Harness: React.FC = () => {
    const [collections, setCollections] = useState<WorkspaceCollectionEntry[]>([
      { filePath: '/c.awjc', collection, isDirty: false },
    ]);
    const [tabs, setTabs] = useState<RequestWorkspaceTab[]>([
      { id: 'tab_root', collectionPath: '/c.awjc', request: root, savedRequest: root, isDirty: false },
    ]);
    const [activeTabId, setActiveTabId] = useState<string | null>('tab_root');
    const [activeCollectionPath, setActiveCollectionPath] = useState<string | null>('/c.awjc');
    probe.ws = useAiWorkspace(
      { collections, tabs, activeTabId, activeCollectionPath, responsesByTab: { tab_root: { status: 201 } as HttpResponseResult }, capturedVars: [] },
      { setCollections, setTabs, setActiveTabId, setActiveCollectionPath, sendRequest },
    );
    probe.collections = collections;
    probe.tabs = tabs;
    probe.activeTabId = activeTabId;
    probe.activeCollectionPath = activeCollectionPath;
    return null;
  };
  render(<Harness />);
  return { probe, sendRequest, root, inFolder };
}

describe('useAiWorkspace', () => {
  it('exposes state, responses, and secret values for scrubbing', () => {
    const { probe } = setup();
    expect(probe.ws.getTabs()).toHaveLength(1);
    expect(probe.ws.getActiveTabId()).toBe('tab_root');
    expect(probe.ws.getResponse('tab_root')?.status).toBe(201);
    expect(probe.ws.getResponse('nope')).toBeNull();
    expect(probe.ws.getSecretValues()).toContain('env-token-1');
  });

  it('updates open tabs and tree items, marking both unsaved', () => {
    const { probe, root } = setup();
    const next: RequestItem = { ...root, url: 'https://changed.test' };
    act(() => probe.ws.updateRequest('req_root', next));
    expect(probe.tabs[0]).toMatchObject({ isDirty: true, request: { url: 'https://changed.test' } });
    expect(probe.tabs[0].savedRequest).toBe(root);
    expect(probe.collections[0].isDirty).toBe(true);
    expect(probe.collections[0].collection.items[1]).toMatchObject({ url: 'https://changed.test' });
  });

  it('updates requests that are only in the tree, including inside folders', () => {
    const { probe, inFolder } = setup();
    act(() => probe.ws.updateRequest('req_folder', { ...inFolder, name: 'Renamed' }));
    const folder = probe.collections[0].collection.items[0];
    expect(folder.kind === 'folder' && folder.items[0]).toMatchObject({ name: 'Renamed' });
    expect(probe.tabs).toHaveLength(1);
  });

  it('opens existing tabs and new ones, and reports unknown ids', () => {
    const { probe } = setup();
    let opened = false;
    act(() => {
      opened = probe.ws.openRequest('req_folder');
    });
    expect(opened).toBe(true);
    expect(probe.tabs).toHaveLength(2);
    expect(probe.activeTabId).toBe(probe.tabs[1].id);
    act(() => {
      opened = probe.ws.openRequest('req_root');
    });
    expect(opened).toBe(true);
    expect(probe.activeTabId).toBe('tab_root');
    expect(probe.tabs).toHaveLength(2);
    act(() => {
      opened = probe.ws.openRequest('missing');
    });
    expect(opened).toBe(false);
  });

  it('adds requests to the root or a folder and opens them', () => {
    const { probe } = setup();
    const a = createDefaultHttpRequest({ id: 'new_a', name: 'A' });
    const b = createDefaultHttpRequest({ id: 'new_b', name: 'B' });
    act(() => probe.ws.addRequest('/c.awjc', undefined, a));
    act(() => probe.ws.addRequest('/c.awjc', 'fld', b));
    const items = probe.collections[0].collection.items;
    expect(items.some(i => i.id === 'new_a')).toBe(true);
    const folder = items[0];
    expect(folder.kind === 'folder' && folder.items.map(i => i.id)).toEqual(['req_folder', 'new_b']);
    expect(probe.tabs.map(t => t.request.id)).toEqual(['req_root', 'new_a', 'new_b']);
    expect(probe.tabs[2].isDirty).toBe(false);
    expect(probe.activeTabId).toBe(probe.tabs[2].id);
  });

  it('applies collection updates and marks the collection unsaved', () => {
    const { probe } = setup();
    act(() => probe.ws.updateCollection('/c.awjc', c => ({ ...c, variables: [{ key: 'a', value: '1', enabled: true }] })));
    expect(probe.collections[0].collection.variables?.[0].key).toBe('a');
    expect(probe.collections[0].isDirty).toBe(true);
  });

  it('sees its own consecutive writes before React re-renders', () => {
    const { probe, root } = setup();
    act(() => {
      probe.ws.updateRequest('req_root', { ...root, name: 'One' });
      probe.ws.updateRequest('req_root', { ...probe.ws.getTabs()[0].request, url: 'https://two.test' });
    });
    expect(probe.tabs[0].request).toMatchObject({ name: 'One', url: 'https://two.test' });
  });

  it('exposes the GraphQL schema published by the workspace', () => {
    const { probe } = setup();
    expect(probe.ws.getGraphqlSchema()).toBeNull();
    const bundle = loadSchemaFromSdl('type Query { a: Int }');
    publishGraphqlSchemaForAi({ introspection: bundle.introspection, metadata: bundle.metadata });
    expect(probe.ws.getGraphqlSchema()?.metadata.queryTypeName).toBe('Query');
    publishGraphqlSchemaForAi(null);
  });

  it('sends through the app send handler', async () => {
    const { probe, sendRequest } = setup();
    await expect(probe.ws.sendActiveRequest()).resolves.toMatchObject({ status: 200 });
    expect(sendRequest).toHaveBeenCalledTimes(1);
  });
});
