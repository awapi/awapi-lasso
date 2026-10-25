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
        onExportCollection={vi.fn()}
        onNewHttpRequest={vi.fn()}
        onNewGraphQLRequest={vi.fn()}
        onNewFolder={vi.fn()}
        onDuplicateItem={vi.fn()}
        onRenameItem={vi.fn()}
        onDeleteItem={vi.fn()}
      />,
    );

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
        onExportCollection={vi.fn()}
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

  it('invokes context menu actions for collection and request items (New, Duplicate, Rename, Delete, Save, Export)', () => {
    const onNewHttpRequest = vi.fn();
    const onExportCollection = vi.fn();
    const onDuplicateItem = vi.fn();
    const onRenameItem = vi.fn();
    const onDeleteItem = vi.fn();

    render(
      <CollectionSidebar
        collections={sampleEntries}
        onSelectCollection={vi.fn()}
        onSelectRequest={vi.fn()}
        onNewCollection={vi.fn()}
        onImportCollection={vi.fn()}
        onSaveCollection={vi.fn()}
        onExportCollection={onExportCollection}
        onNewHttpRequest={onNewHttpRequest}
        onNewGraphQLRequest={vi.fn()}
        onNewFolder={vi.fn()}
        onDuplicateItem={onDuplicateItem}
        onRenameItem={onRenameItem}
        onDeleteItem={onDeleteItem}
      />,
    );

    // Open collection menu
    fireEvent.click(screen.getByTestId('collection-menu-btn-col_payments'));
    fireEvent.click(screen.getByTestId('col-menu-new-http-col_payments'));
    expect(onNewHttpRequest).toHaveBeenCalledWith('/Users/me/apis/payments.awjc');

    fireEvent.click(screen.getByTestId('collection-menu-btn-col_payments'));
    fireEvent.click(screen.getByTestId('col-menu-export-yaml-col_payments'));
    expect(onExportCollection).toHaveBeenCalledWith('/Users/me/apis/payments.awjc', 'yaml');

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
        onExportCollection={vi.fn()}
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
});
