import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { CollectionSidebar, type WorkspaceCollectionEntry } from './CollectionSidebar';
import {
  createDefaultFolder,
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
  createEmptyCollection,
} from '../../../shared/collectionSchema';

const getReq = createDefaultHttpRequest({
  id: 'req_get_users',
  name: 'Get Users',
  method: 'GET',
  url: '{{baseUrl}}/v1/users',
});

const gqlReq = createDefaultGraphQLRequest({
  id: 'req_gql_orders',
  name: 'Query Orders',
  url: '{{baseUrl}}/graphql',
});

const adminFolder = createDefaultFolder('Admin', [gqlReq], { id: 'fld_admin' });

const sampleCollection = createEmptyCollection('Payments API', {
  metadata: { id: 'col_payments', name: 'Payments API' },
  items: [getReq, adminFolder],
});

const sampleEntries: WorkspaceCollectionEntry[] = [
  {
    filePath: '/Users/me/apis/payments.awjc',
    collection: sampleCollection,
    isDirty: true,
  },
];

describe('CollectionSidebar', () => {
  it('renders nested folders and requests with method/protocol badges and filters by search query', () => {
    const onSelectRequest = vi.fn();
    const onOpenGitSourceControl = vi.fn();

    render(
      <CollectionSidebar
        collections={sampleEntries}
        activeCollectionPath="/Users/me/apis/payments.awjc"
        activeRequestId="req_get_users"
        onSelectCollection={vi.fn()}
        onSelectRequest={onSelectRequest}
        onNewCollection={vi.fn()}
        onImportCollection={vi.fn()}
        onSaveCollection={vi.fn()}
        onSaveCollectionAs={vi.fn()}
        onNewHttpRequest={vi.fn()}
        onNewGraphQLRequest={vi.fn()}
        onNewFolder={vi.fn()}
        onDuplicateItem={vi.fn()}
        onRenameItem={vi.fn()}
        onDeleteItem={vi.fn()}
        gitStatusByCollectionPath={{
          '/Users/me/apis/payments.awjc': {
            collectionFilePath: '/Users/me/apis/payments.awjc',
            folderPath: '/Users/me/apis',
            isGitRepo: true,
            branch: 'main',
            ahead: 0,
            behind: 0,
            fileStatus: 'modified',
            folderChangedFiles: [],
            branches: ['main'],
            safety: {
              safe: true,
              secretsSidecarIgnored: true,
              hasPlaintextSecrets: false,
              plaintextSecretWarnings: [],
              issues: [],
            },
          },
        }}
        onOpenGitSourceControl={onOpenGitSourceControl}
      />,
    );

    const gitBadge = screen.getByTestId('collection-git-badge-col_payments');
    expect(gitBadge).toHaveTextContent('main');
    fireEvent.click(gitBadge);
    expect(onOpenGitSourceControl).toHaveBeenCalledWith('/Users/me/apis/payments.awjc');

    expect(screen.getByTestId('request-badge-req_get_users')).toHaveTextContent('GET');
    expect(screen.getByTestId('request-badge-req_gql_orders')).toHaveTextContent('GQL');

    fireEvent.click(screen.getByTestId('tree-request-req_get_users'));
    expect(onSelectRequest).toHaveBeenCalledWith('/Users/me/apis/payments.awjc', getReq);

    // Search filter
    const searchInput = screen.getByTestId('sidebar-search-input');
    fireEvent.change(searchInput, { target: { value: 'Orders' } });

    expect(screen.queryByTestId('tree-request-req_get_users')).not.toBeInTheDocument();
    expect(screen.getByTestId('tree-request-req_gql_orders')).toBeInTheDocument();
  });

  it('switches between Collections and History views', () => {
    const onSelectHistoryEntry = vi.fn();

    render(
      <CollectionSidebar
        collections={sampleEntries}
        historyEntries={[
          {
            id: 'hist_1',
            timestamp: '2026-10-24T12:00:00Z',
            method: 'POST',
            protocol: 'http',
            url: 'https://api.example.com/v1/charge',
            status: 201,
          },
        ]}
        onSelectCollection={vi.fn()}
        onSelectRequest={vi.fn()}
        onSelectHistoryEntry={onSelectHistoryEntry}
        onNewCollection={vi.fn()}
        onImportCollection={vi.fn()}
        onSaveCollection={vi.fn()}
        onSaveCollectionAs={vi.fn()}
        onNewHttpRequest={vi.fn()}
        onNewGraphQLRequest={vi.fn()}
        onNewFolder={vi.fn()}
        onDuplicateItem={vi.fn()}
        onRenameItem={vi.fn()}
        onDeleteItem={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('sidebar-mode-history'));
    expect(screen.getByTestId('sidebar-history-view')).toBeInTheDocument();
    const histItem = screen.getByTestId('history-entry-hist_1');
    expect(histItem).toHaveTextContent('https://api.example.com/v1/charge');

    fireEvent.click(histItem);
    expect(onSelectHistoryEntry).toHaveBeenCalledTimes(1);
  });

  it('invokes context menu actions for collection and request items (New, Duplicate, Rename, Delete, Save, Save As, Close, Generate Code)', () => {
    const onNewHttpRequest = vi.fn();
    const onSaveCollectionAs = vi.fn();
    const onCloseCollection = vi.fn();
    const onDuplicateItem = vi.fn();
    const onRenameCollection = vi.fn();
    const onRenameItem = vi.fn();
    const onDeleteItem = vi.fn();
    const onGenerateCodeForRequest = vi.fn();

    render(
      <CollectionSidebar
        collections={sampleEntries}
        onSelectCollection={vi.fn()}
        onSelectRequest={vi.fn()}
        onNewCollection={vi.fn()}
        onImportCollection={vi.fn()}
        onSaveCollection={vi.fn()}
        onSaveCollectionAs={onSaveCollectionAs}
        onCloseCollection={onCloseCollection}
        onNewHttpRequest={onNewHttpRequest}
        onNewGraphQLRequest={vi.fn()}
        onNewFolder={vi.fn()}
        onDuplicateItem={onDuplicateItem}
        onRenameCollection={onRenameCollection}
        onRenameItem={onRenameItem}
        onDeleteItem={onDeleteItem}
        onGenerateCodeForRequest={onGenerateCodeForRequest}
      />,
    );

    // Open collection menu
    fireEvent.click(screen.getByTestId('collection-menu-btn-col_payments'));
    fireEvent.click(screen.getByTestId('col-menu-new-http-col_payments'));
    expect(onNewHttpRequest).toHaveBeenCalledWith('/Users/me/apis/payments.awjc');

    // Open collection menu -> Rename
    fireEvent.click(screen.getByTestId('collection-menu-btn-col_payments'));
    fireEvent.click(screen.getByTestId('col-menu-rename-col_payments'));
    const colRenameInput = screen.getByTestId('rename-collection-input-col_payments');
    fireEvent.change(colRenameInput, { target: { value: 'Billing & Payments API' } });
    fireEvent.keyDown(colRenameInput, { key: 'Enter' });
    expect(onRenameCollection).toHaveBeenCalledWith(
      '/Users/me/apis/payments.awjc',
      'Billing & Payments API',
    );

    fireEvent.click(screen.getByTestId('collection-menu-btn-col_payments'));
    fireEvent.click(screen.getByTestId('col-menu-save-as-col_payments'));
    expect(onSaveCollectionAs).toHaveBeenCalledWith('/Users/me/apis/payments.awjc');

    fireEvent.click(screen.getByTestId('collection-menu-btn-col_payments'));
    fireEvent.click(screen.getByTestId('col-menu-close-col_payments'));
    expect(onCloseCollection).toHaveBeenCalledWith('/Users/me/apis/payments.awjc');

    // Open request item menu -> Generate Code Snippet…
    fireEvent.click(screen.getByTestId('item-menu-btn-req_get_users'));
    fireEvent.click(screen.getByTestId('menu-generate-code-req_get_users'));
    expect(onGenerateCodeForRequest).toHaveBeenCalledWith(
      '/Users/me/apis/payments.awjc',
      getReq,
    );

    // Open request item menu -> Duplicate
    fireEvent.click(screen.getByTestId('item-menu-btn-req_get_users'));
    fireEvent.click(screen.getByTestId('menu-duplicate-req_get_users'));
    expect(onDuplicateItem).toHaveBeenCalledWith('/Users/me/apis/payments.awjc', 'req_get_users');

    // Open request item menu -> Rename
    fireEvent.click(screen.getByTestId('item-menu-btn-req_get_users'));
    fireEvent.click(screen.getByTestId('menu-rename-req_get_users'));
    const renameInput = screen.getByTestId('rename-input-req_get_users');
    fireEvent.change(renameInput, { target: { value: 'List Active Users' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });
    expect(onRenameItem).toHaveBeenCalledWith(
      '/Users/me/apis/payments.awjc',
      'req_get_users',
      'List Active Users',
    );

    // Open request item menu -> Delete
    fireEvent.click(screen.getByTestId('item-menu-btn-req_get_users'));
    fireEvent.click(screen.getByTestId('menu-delete-req_get_users'));
    expect(onDeleteItem).toHaveBeenCalledWith('/Users/me/apis/payments.awjc', 'req_get_users');
  });

  it('closes any open sidebar context menu when clicking outside or pressing Escape', () => {
    render(
      <CollectionSidebar
        collections={sampleEntries}
        onSelectCollection={vi.fn()}
        onSelectRequest={vi.fn()}
        onNewCollection={vi.fn()}
        onImportCollection={vi.fn()}
        onSaveCollection={vi.fn()}
        onSaveCollectionAs={vi.fn()}
        onNewHttpRequest={vi.fn()}
        onNewGraphQLRequest={vi.fn()}
        onNewFolder={vi.fn()}
        onDuplicateItem={vi.fn()}
        onRenameItem={vi.fn()}
        onDeleteItem={vi.fn()}
      />,
    );

    // Open folder context menu
    fireEvent.click(screen.getByTestId('item-menu-btn-fld_admin'));
    expect(screen.getByTestId('context-menu-fld_admin')).toBeInTheDocument();

    // Clicking outside closes the popup
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('context-menu-fld_admin')).not.toBeInTheDocument();

    // Reopen and press Escape to close
    fireEvent.click(screen.getByTestId('item-menu-btn-fld_admin'));
    expect(screen.getByTestId('context-menu-fld_admin')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('context-menu-fld_admin')).not.toBeInTheDocument();
  });

  it('renders independent scrollable collection sections and a draggable splitter between collections', () => {
    const secondCollection = createEmptyCollection('Public Web APIs', {
      metadata: { id: 'col_public', name: 'Public Web APIs' },
      items: [getReq],
    });

    const multiEntries: WorkspaceCollectionEntry[] = [
      ...sampleEntries,
      {
        filePath: '/Users/me/apis/public.awjc',
        collection: secondCollection,
      },
    ];

    render(
      <CollectionSidebar
        collections={multiEntries}
        activeCollectionPath="/Users/me/apis/payments.awjc"
        onSelectCollection={vi.fn()}
        onSelectRequest={vi.fn()}
        onNewCollection={vi.fn()}
        onImportCollection={vi.fn()}
        onSaveCollection={vi.fn()}
        onSaveCollectionAs={vi.fn()}
        onNewHttpRequest={vi.fn()}
        onNewGraphQLRequest={vi.fn()}
        onNewFolder={vi.fn()}
        onDuplicateItem={vi.fn()}
        onRenameItem={vi.fn()}
        onDeleteItem={vi.fn()}
      />,
    );

    const firstTree = screen.getByTestId('collection-tree-col_payments');
    const secondTree = screen.getByTestId('collection-tree-col_public');
    expect(firstTree).toHaveStyle({ overflowY: 'auto' });
    expect(secondTree).toHaveStyle({ overflowY: 'auto' });

    const splitter = screen.getByTestId('collection-splitter-0');
    expect(splitter).toHaveAttribute('role', 'separator');
    expect(splitter).toHaveStyle({ cursor: 'row-resize' });

    const firstNode = screen.getByTestId('collection-node-col_payments');
    const secondNode = screen.getByTestId('collection-node-col_public');

    // Drag splitter down by 60px (default fallback start height in jsdom is 240 -> 300px)
    fireEvent.mouseDown(splitter, { clientY: 200 });
    fireEvent.mouseMove(window, { clientY: 260 });
    fireEvent.mouseUp(window);

    expect(firstNode).toHaveStyle({ height: '300px' });
    expect(secondNode).toHaveStyle({ flex: '1 1 0%' });

    // Double-click resets custom height back to equal flex distribution
    fireEvent.doubleClick(splitter);
    expect(firstNode).toHaveStyle({ flex: '1 1 0%' });
  });
});
