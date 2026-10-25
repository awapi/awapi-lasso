import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RequestHistoryDrawer } from './RequestHistoryDrawer';
import { createDefaultHttpRequest } from '../../../shared/collectionSchema';
import type { RequestHistoryEntry } from './CollectionSidebar';

describe('RequestHistoryDrawer', () => {
  const sampleEntries: RequestHistoryEntry[] = [
    {
      id: 'hist_1',
      timestamp: '2026-10-25T15:30:00.000Z',
      method: 'GET',
      protocol: 'http',
      url: 'https://api.example.com/v1/orders',
      status: 200,
      durationMs: 42,
      requestSnapshot: createDefaultHttpRequest({
        id: 'req_1',
        name: 'List Orders',
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
      }),
    },
    {
      id: 'hist_2',
      timestamp: '2026-10-25T15:31:00.000Z',
      method: 'POST',
      protocol: 'http',
      url: 'https://api.example.com/v1/checkout',
      status: 500,
      durationMs: 118,
      requestSnapshot: createDefaultHttpRequest({
        id: 'req_2',
        name: 'Checkout',
        method: 'POST',
        url: 'https://api.example.com/v1/checkout',
      }),
    },
  ];

  it('displays status badges, timestamps, durations, filters entries, and triggers Restore to Tab and Save to Collection', () => {
    const onRestoreToTab = vi.fn();
    const onSaveToCollection = vi.fn();
    const onClearHistory = vi.fn();

    render(
      <RequestHistoryDrawer
        entries={sampleEntries}
        onRestoreToTab={onRestoreToTab}
        onSaveToCollection={onSaveToCollection}
        onClearHistory={onClearHistory}
      />,
    );

    expect(screen.getByTestId('history-status-badge-hist_1')).toHaveTextContent('200');
    expect(screen.getByTestId('history-duration-hist_1')).toHaveTextContent('42 ms');
    expect(screen.getByTestId('history-status-badge-hist_2')).toHaveTextContent('500');

    // One-click Restore to Tab
    fireEvent.click(screen.getByTestId('history-restore-btn-hist_1'));
    expect(onRestoreToTab).toHaveBeenCalledWith(sampleEntries[0]);

    // One-click Save to Collection
    fireEvent.click(screen.getByTestId('history-save-to-col-btn-hist_2'));
    expect(onSaveToCollection).toHaveBeenCalledWith(sampleEntries[1]);

    // Filter by status or URL
    fireEvent.change(screen.getByTestId('history-drawer-search-input'), {
      target: { value: 'checkout' },
    });
    expect(screen.queryByTestId('history-entry-hist_1')).not.toBeInTheDocument();
    expect(screen.getByTestId('history-entry-hist_2')).toBeInTheDocument();

    // Clear history
    fireEvent.click(screen.getByTestId('history-drawer-clear-btn'));
    expect(onClearHistory).toHaveBeenCalledTimes(1);
  });
});
